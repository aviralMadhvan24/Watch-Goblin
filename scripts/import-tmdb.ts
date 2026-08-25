/**
 * Catalogue ingest.
 *
 * Pulls shows from whichever `MetadataProvider` is configured and writes them
 * through `catalogService.importShow`, which upserts on
 * (sourceProvider, sourceId) — so re-running this refreshes existing rows
 * rather than duplicating them.
 *
 * Usage:
 *   npm run import:tmdb                    # trending anime + TV, 20 each
 *   npm run import:tmdb -- --limit 60      # more of each
 *   npm run import:tmdb -- --type ANIME    # one type only
 *   npm run import:tmdb -- --query "one piece"
 *
 * Season/episode trees cost one request per season, so this deliberately runs
 * shows sequentially with a small delay: TMDB allows ~50 req/s, and a burst of
 * parallel imports on a 20-season show is the fastest way to get throttled.
 */

// Must precede any import that reads env at module scope — `config/env.server`
// parses `process.env` on first import and throws if it is empty.
import "dotenv/config";

import { db } from "@/db/client";
import type { ShowType } from "@/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { catalogService } from "@/server/services/catalog.service";
import { metadataProvider, type ExternalShowSummary } from "@/server/integrations/metadata";

interface Options {
  limit: number;
  type?: ShowType;
  query?: string;
  backfill: boolean;
  /** How many shows to fetch from the provider at once. Writes stay serial. */
  concurrency: number;
  /** Re-fetch shows already in the catalogue instead of skipping them. */
  refresh: boolean;
}

/**
 * Detail fetches run in parallel; database writes do not.
 *
 * TMDB tolerates ~50 req/s, so the network side is not the constraint — the
 * constraint is that `importShow` upserts shared rows (genres, studios,
 * networks, people) keyed by slug. Two shows importing "Netflix" or "Studio
 * Ghibli" at the same moment both see "no row", both insert, and one dies on
 * the unique index, aborting its transaction. Fetching wide and writing narrow
 * gets the speed-up without that race.
 */
const DEFAULT_CONCURRENCY = 6;

function parseArgs(argv: string[]): Options {
  const options: Options = {
    limit: 20,
    backfill: false,
    concurrency: DEFAULT_CONCURRENCY,
    refresh: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--backfill") {
      options.backfill = true;
    } else if (arg === "--refresh") {
      options.refresh = true;
    } else if (arg === "--concurrency" && next) {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`--concurrency must be a positive number, got "${next}"`);
      }
      // TMDB starts throttling well above this; the cap is here so a typo
      // cannot turn the import into an accidental burst.
      options.concurrency = Math.min(Math.floor(parsed), 16);
      i += 1;
    } else if (arg === "--limit" && next) {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`--limit must be a positive number, got "${next}"`);
      }
      options.limit = Math.floor(parsed);
      i += 1;
    } else if (arg === "--type" && next) {
      const upper = next.toUpperCase();
      if (upper !== "ANIME" && upper !== "TV") {
        throw new Error(`--type must be ANIME or TV, got "${next}"`);
      }
      options.type = upper;
      i += 1;
    } else if (arg === "--query" && next) {
      options.query = next;
      i += 1;
    }
  }

  return options;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function collect(options: Options): Promise<ExternalShowSummary[]> {
  if (options.query) {
    return metadataProvider.search({ query: options.query, type: options.type, limit: options.limit });
  }

  const types: ShowType[] = options.type ? [options.type] : ["ANIME", "TV"];
  const summaries: ExternalShowSummary[] = [];

  for (const type of types) {
    summaries.push(...(await metadataProvider.trending({ type, limit: options.limit })));
  }

  // Trending anime and trending TV overlap on TMDB, since anime is just TV with
  // a Japanese original language. De-duplicate before spending requests on the
  // per-season fetches.
  const seen = new Set<string>();
  return summaries.filter((summary) => {
    const key = `${summary.provider}:${summary.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Loose title match, so "Frieren: Beyond Journey's End" meets "Frieren". */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Fills artwork and blurb into shows that are already in the catalogue, instead
 * of inserting new rows for them.
 *
 * Deliberately touches only presentation fields — poster, backdrop, synopsis,
 * external rating. It does NOT resync the season/episode tree: existing users
 * have `UserEpisode` rows and progress caches pinned to the current episode
 * list, and swapping that out underneath them would silently rewrite everyone's
 * progress. Adding episodes is a separate, deliberate operation.
 */
async function backfillArtwork(options: Options) {
  // Two jobs: shows still missing artwork, and shows still carrying the seed's
  // `local` identity. The second matters because `importShow` upserts on
  // (sourceProvider, sourceId) — until a seeded row is re-pointed at its TMDB
  // id, a later import inserts a *second* copy of that show beside it.
  const shows = await db.show.findMany({
    where: {
      OR: [{ posterUrl: null }, { sourceProvider: { not: metadataProvider.name } }],
    },
    select: { id: true, title: true, type: true, slug: true, sourceProvider: true },
    orderBy: { popularity: "desc" },
    take: options.limit,
  });

  if (shows.length === 0) {
    console.log("Every show already has artwork and a provider identity. Nothing to backfill.");
    return;
  }

  console.log(`Backfilling ${shows.length} shows (artwork + provider identity)…\n`);

  let updated = 0;
  let missed = 0;

  for (const [index, show] of shows.entries()) {
    const position = `${String(index + 1).padStart(3)}/${shows.length}`;

    const results = await metadataProvider.search({ query: show.title, limit: 5 });
    const wanted = normalizeTitle(show.title);
    const match =
      results.find((candidate) => normalizeTitle(candidate.title) === wanted) ??
      results.find((candidate) => normalizeTitle(candidate.title).startsWith(wanted)) ??
      results.find((candidate) => wanted.startsWith(normalizeTitle(candidate.title))) ??
      results[0];

    if (!match?.posterUrl) {
      console.log(`${position}  MISS  ${show.title}`);
      missed += 1;
      await sleep(120);
      continue;
    }

    // Only claim the provider identity if no other row already holds it —
    // (sourceProvider, sourceId) is unique, and two local titles can search to
    // the same TMDB entry.
    const identityTaken = await db.show.findFirst({
      where: {
        sourceProvider: match.provider,
        sourceId: match.externalId,
        id: { not: show.id },
      },
      select: { id: true },
    });

    await db.show.update({
      where: { id: show.id },
      data: {
        posterUrl: match.posterUrl,
        backdropUrl: match.backdropUrl ?? undefined,
        synopsis: match.synopsis ?? undefined,
        externalRating: match.externalRating ?? undefined,
        popularity: match.popularity || undefined,
        ...(identityTaken
          ? {}
          : { sourceProvider: match.provider, sourceId: match.externalId }),
      },
    });

    console.log(
      `${position}  OK    ${show.title}  ←  ${match.title}${identityTaken ? "  (identity already claimed, artwork only)" : ""}`,
    );
    updated += 1;
    await sleep(120);
  }

  const withPosters = await db.show.count({ where: { posterUrl: { not: null } } });
  const total = await db.show.count();
  console.log(
    `\nBackfilled ${updated}, no match for ${missed}.` +
      `\nCatalogue now: ${withPosters}/${total} shows have posters.`,
  );
}

/**
 * Drops summaries whose (provider, id) is already a row, so a re-run resumes
 * where the last one stopped instead of re-fetching the whole catalogue.
 *
 * Queried in chunks: this list runs to thousands of ids, and a single `IN (…)`
 * that long is both a poor plan and, past Postgres' parameter ceiling, an error.
 */
async function withoutAlreadyImported(
  summaries: ExternalShowSummary[],
): Promise<ExternalShowSummary[]> {
  const known = new Set<string>();
  const chunk = 500;

  for (let offset = 0; offset < summaries.length; offset += chunk) {
    const window = summaries.slice(offset, offset + chunk);
    const rows = await db.show.findMany({
      where: {
        sourceProvider: metadataProvider.name,
        sourceId: { in: window.map((summary) => summary.externalId) },
      },
      select: { sourceId: true },
    });
    // `sourceId` is nullable on the model — a locally seeded show has no
    // provider identity — so a null cannot be a match for anything here.
    for (const row of rows) if (row.sourceId) known.add(row.sourceId);
  }

  return summaries.filter((summary) => !known.has(summary.externalId));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.backfill) {
    console.log(`Provider: ${metadataProvider.name} · backfill artwork · limit ${options.limit}`);
    await backfillArtwork(options);
    return;
  }

  console.log(
    `Provider: ${metadataProvider.name} · ${options.query ? `query "${options.query}"` : "trending"} · limit ${options.limit}`,
  );

  const summaries = await collect(options);

  if (summaries.length === 0) {
    console.error(
      "No shows returned. Check TMDB_API_KEY and METADATA_PROVIDER in .env — a bad key logs a 401 and yields an empty list.",
    );
    process.exitCode = 1;
    return;
  }

  const pending = options.refresh ? summaries : await withoutAlreadyImported(summaries);
  const skipped = summaries.length - pending.length;

  console.log(
    `Found ${summaries.length} shows` +
      (skipped > 0 ? `, ${skipped} already in the catalogue` : "") +
      `. Importing ${pending.length} at concurrency ${options.concurrency}…\n`,
  );

  let imported = 0;
  let failed = 0;
  let done = 0;

  // Fetch a window of shows in parallel, then write that window one at a time.
  // See DEFAULT_CONCURRENCY for why the writes cannot also be parallel.
  for (let offset = 0; offset < pending.length; offset += options.concurrency) {
    const window = pending.slice(offset, offset + options.concurrency);

    const fetched = await Promise.all(
      window.map(async (summary) => {
        try {
          return { summary, detail: await metadataProvider.getShow(summary.externalId), error: null };
        } catch (error) {
          return { summary, detail: null, error: error as Error };
        }
      }),
    );

    for (const result of fetched) {
      done += 1;
      const position = `${String(done).padStart(4)}/${pending.length}`;

      if (result.error) {
        console.log(`${position}  FAIL  ${result.summary.title}: ${result.error.message}`);
        logger.error("Import fetch failed", result.error, { title: result.summary.title });
        failed += 1;
        continue;
      }

      const detail = result.detail;
      if (!detail) {
        // `getShow` also returns null for a title the porn gate rejected, which
        // is a correct outcome rather than a fault — but it is indistinguishable
        // from a dead request here, so both land in the same bucket.
        console.log(`${position}  SKIP  ${result.summary.title} (no detail returned)`);
        failed += 1;
        continue;
      }

      try {
        await catalogService.importShow(detail);
        const episodes = detail.seasons.reduce((sum, season) => sum + season.episodes.length, 0);

        console.log(
          `${position}  OK    ${detail.title} — ${detail.seasons.length} seasons, ${episodes} episodes${detail.posterUrl ? "" : " (no poster)"}`,
        );
        imported += 1;
      } catch (error) {
        console.log(`${position}  FAIL  ${detail.title}: ${(error as Error).message}`);
        logger.error("Import write failed", error, { title: detail.title });
        failed += 1;
      }
    }
  }

  const [shows, episodes, withPosters] = await Promise.all([
    db.show.count(),
    db.episode.count(),
    db.show.count({ where: { posterUrl: { not: null } } }),
  ]);

  console.log(
    `\nImported ${imported}, failed ${failed}.` +
      `\nCatalogue now: ${shows} shows (${withPosters} with posters), ${episodes} episodes.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
