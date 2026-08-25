import "server-only";

import { db, type DbClient } from "@/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { slugify } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type {
  ExternalShowDetail,
  ExternalShowSummary,
  SearchOptions,
} from "@/server/integrations/metadata";
import type { ShowType } from "@/generated/prisma/enums";

/**
 * Turns provider data into catalogue rows.
 *
 * Idempotent by construction: a show is identified by
 * (sourceProvider, sourceId), seasons by (showId, number) and episodes by
 * (seasonId, number), all unique in the schema. Importing the same show twice
 * updates it in place rather than duplicating it — which matters because both
 * the seed and the "user opened a show we have not cached yet" path go through
 * here.
 *
 * Existing user progress survives a re-import: episodes are matched by season
 * and number, so a re-synced episode keeps its id and every `user_episodes` row
 * pointing at it.
 */

export const catalogService = {
  /**
   * Inserts or updates a show and its whole season/episode tree.
   * Runs in one transaction so a show is never half-imported.
   */
  async importShow(detail: ExternalShowDetail, client: DbClient = db): Promise<string> {
    const slug = await this.uniqueSlug(detail.title, detail.provider, detail.externalId, client);

    const show = await client.show.upsert({
      where: {
        show_source_identity: {
          sourceProvider: detail.provider,
          sourceId: detail.externalId,
        },
      },
      create: {
        slug,
        type: detail.type,
        title: detail.title,
        originalTitle: detail.originalTitle ?? null,
        synopsis: detail.synopsis ?? null,
        posterUrl: detail.posterUrl ?? null,
        backdropUrl: detail.backdropUrl ?? null,
        airingStatus: detail.airingStatus,
        firstAirDate: detail.firstAirDate ?? null,
        lastAirDate: detail.lastAirDate ?? null,
        averageRuntimeMinutes: detail.averageRuntimeMinutes,
        originalLanguage: detail.originalLanguage,
        popularity: detail.popularity,
        externalRating: detail.externalRating ?? null,
        sourceProvider: detail.provider,
        sourceId: detail.externalId,
      },
      update: {
        // Deliberately does not touch slug (URLs must stay stable) or the
        // community rating caches (they are ours, not the provider's).
        title: detail.title,
        originalTitle: detail.originalTitle ?? null,
        synopsis: detail.synopsis ?? null,
        posterUrl: detail.posterUrl ?? null,
        backdropUrl: detail.backdropUrl ?? null,
        airingStatus: detail.airingStatus,
        firstAirDate: detail.firstAirDate ?? null,
        lastAirDate: detail.lastAirDate ?? null,
        averageRuntimeMinutes: detail.averageRuntimeMinutes,
        popularity: detail.popularity,
        externalRating: detail.externalRating ?? null,
      },
      select: { id: true },
    });

    await this.syncGenres(client, show.id, detail.genres);
    await this.syncCredits(client, show.id, detail.credits ?? []);
    await this.syncCast(client, show.id, detail.cast ?? []);
    const totals = await this.syncSeasons(client, show.id, detail.seasons ?? []);

    await client.show.update({
      where: { id: show.id },
      data: {
        totalSeasons: totals.seasons,
        totalEpisodes: totals.episodes,
      },
    });

    logger.debug("Imported show", { showId: show.id, title: detail.title, ...totals });
    return show.id;
  },

  /**
   * Slugs are the public URL, so they must be unique and must never change once
   * assigned. A collision gets a numeric suffix.
   */
  async uniqueSlug(
    title: string,
    provider: string,
    externalId: string,
    client: DbClient = db,
  ): Promise<string> {
    const existing = await client.show.findUnique({
      where: { show_source_identity: { sourceProvider: provider, sourceId: externalId } },
      select: { slug: true },
    });
    if (existing) return existing.slug;

    const base = slugify(title) || "show";
    let candidate = base;

    for (let suffix = 2; suffix < 100; suffix++) {
      const taken = await client.show.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
      candidate = `${base}-${suffix}`;
    }

    return `${base}-${externalId}`;
  },

  async syncGenres(client: DbClient, showId: string, names: string[]): Promise<void> {
    if (names.length === 0) return;

    const genres = await Promise.all(
      names.map((name) =>
        client.genre.upsert({
          where: { slug: slugify(name) },
          create: { slug: slugify(name), name },
          update: {},
          select: { id: true },
        }),
      ),
    );

    await client.showGenre.createMany({
      data: genres.map((genre) => ({ showId, genreId: genre.id })),
      skipDuplicates: true,
    });
  },

  async syncCredits(
    client: DbClient,
    showId: string,
    credits: { name: string; kind: "STUDIO" | "NETWORK" }[],
  ): Promise<void> {
    if (credits.length === 0) return;

    // Deduplicated by slug and issued sequentially, not `Promise.all`.
    // Parallel upserts on the same slug race: both see "no row", both insert,
    // and one loses on the unique index. That aborts the surrounding Postgres
    // transaction, taking the whole show import down with it — and a provider
    // listing the same studio twice, or two names that slugify alike, is
    // routine rather than exotic.
    const bySlug = new Map<string, { name: string; kind: "STUDIO" | "NETWORK" }>();
    for (const credit of credits) {
      bySlug.set(slugify(`${credit.kind}-${credit.name}`), credit);
    }

    const rows: { id: string }[] = [];
    for (const [slug, credit] of bySlug) {
      rows.push(
        await client.credit.upsert({
          where: { slug },
          create: { slug, name: credit.name, kind: credit.kind },
          update: {},
          select: { id: true },
        }),
      );
    }

    await client.showCredit.createMany({
      data: rows.map((row) => ({ showId, creditId: row.id })),
      skipDuplicates: true,
    });
  },

  async syncCast(
    client: DbClient,
    showId: string,
    cast: { name: string; character?: string | null; photoUrl?: string | null; order: number }[],
  ): Promise<void> {
    for (const member of cast) {
      const person = await client.person.upsert({
        where: { slug: slugify(member.name) },
        create: { slug: slugify(member.name), name: member.name, photoUrl: member.photoUrl ?? null },
        update: { photoUrl: member.photoUrl ?? undefined },
        select: { id: true },
      });

      const existing = await client.castMember.findFirst({
        where: { showId, personId: person.id, character: member.character ?? null },
        select: { id: true },
      });

      if (existing) {
        await client.castMember.update({ where: { id: existing.id }, data: { order: member.order } });
      } else {
        await client.castMember.create({
          data: {
            showId,
            personId: person.id,
            character: member.character ?? null,
            order: member.order,
          },
        });
      }
    }
  },

  /**
   * Upserts seasons and episodes, returning the true totals counted from the
   * rows we actually stored rather than trusting the provider's own counts —
   * progress percentages are computed against these numbers, so they have to
   * match reality.
   */
  async syncSeasons(
    client: DbClient,
    showId: string,
    seasons: ExternalShowDetail["seasons"],
  ): Promise<{ seasons: number; episodes: number }> {
    let episodeTotal = 0;
    let seasonTotal = 0;

    for (const season of seasons) {
      const seasonRow = await client.season.upsert({
        where: { showId_number: { showId, number: season.number } },
        create: {
          showId,
          number: season.number,
          title: season.title ?? null,
          overview: season.overview ?? null,
          posterUrl: season.posterUrl ?? null,
          airDate: season.airDate ?? null,
          episodeCount: season.episodes.length,
        },
        update: {
          title: season.title ?? null,
          overview: season.overview ?? null,
          posterUrl: season.posterUrl ?? null,
          airDate: season.airDate ?? null,
          episodeCount: season.episodes.length,
        },
        select: { id: true },
      });

      // Episodes are written in bulk rather than one upsert per row. A single
      // long-running series carries a thousand-plus episodes, and a per-episode
      // round trip is what pushes a first import of One Piece or Doraemon past
      // the transaction timeout on the on-demand path — the same loop also
      // dominates the runtime of a full catalogue import.
      const existing = await client.episode.findMany({
        where: { seasonId: seasonRow.id },
        select: {
          id: true,
          number: true,
          seasonNumber: true,
          title: true,
          overview: true,
          airDate: true,
          runtimeMinutes: true,
          stillUrl: true,
        },
      });
      const byNumber = new Map(existing.map((row) => [row.number, row]));

      const inserts: Prisma.EpisodeCreateManyInput[] = [];

      for (const episode of season.episodes) {
        const fields = {
          seasonNumber: season.number,
          title: episode.title ?? null,
          overview: episode.overview ?? null,
          airDate: episode.airDate ?? null,
          runtimeMinutes: episode.runtimeMinutes ?? null,
          stillUrl: episode.stillUrl ?? null,
        };

        const current = byNumber.get(episode.number);

        if (!current) {
          inserts.push({ showId, seasonId: seasonRow.id, number: episode.number, ...fields });
          continue;
        }

        // Only rows the provider actually changed are written back, so
        // re-importing an unchanged season costs one SELECT and no writes.
        // Episode ids are preserved either way, which is what keeps every
        // `user_episodes` row pointing at the right episode across a refresh.
        if (
          current.seasonNumber === fields.seasonNumber &&
          current.title === fields.title &&
          current.overview === fields.overview &&
          sameInstant(current.airDate, fields.airDate) &&
          current.runtimeMinutes === fields.runtimeMinutes &&
          current.stillUrl === fields.stillUrl
        ) {
          continue;
        }

        await client.episode.update({ where: { id: current.id }, data: fields });
      }

      if (inserts.length > 0) {
        // `skipDuplicates` covers the race where two imports of the same show
        // overlap: (seasonId, number) is unique, so without it the loser would
        // abort the surrounding transaction instead of simply writing nothing.
        await client.episode.createMany({ data: inserts, skipDuplicates: true });
      }

      // Specials (season 0) are excluded from totals so a show with specials
      // can still reach 100%.
      if (season.number > 0) {
        seasonTotal += 1;
        episodeTotal += season.episodes.length;
      }
    }

    return { seasons: seasonTotal, episodes: episodeTotal };
  },

  /**
   * Returns the local show for a provider id, importing it on first sight.
   * This is what lets a user open a show the catalogue has never seen.
   */
  async ensureShowImported(
    provider: { getShow(id: string): Promise<ExternalShowDetail | null> },
    externalId: string,
  ): Promise<string | null> {
    const detail = await provider.getShow(externalId);
    if (!detail) return null;
    return db.$transaction((tx) => this.importShow(detail, tx), { timeout: 30_000 });
  },

  /**
   * Provider-side search with everything we already hold removed, so the caller
   * can present "not in the catalogue yet" results beside the local ones.
   *
   * Nothing is imported here. A search returns a page of results of which the
   * user opens at most one, and importing a show costs a request per season —
   * so the import is deferred to `ensureShowImported` at click time, and this
   * returns only the summaries needed to draw a card.
   */
  async searchRemote(
    provider: { name: string; search(options: SearchOptions): Promise<ExternalShowSummary[]> },
    query: string,
    type?: ShowType,
    limit = 12,
  ): Promise<ExternalShowSummary[]> {
    const results = await provider.search({ query, type, limit });
    if (results.length === 0) return [];

    const known = await db.show.findMany({
      where: {
        sourceProvider: provider.name,
        sourceId: { in: results.map((result) => result.externalId) },
      },
      select: { sourceId: true },
    });

    const alreadyLocal = new Set(known.map((row) => row.sourceId));
    return results.filter((result) => !alreadyLocal.has(result.externalId));
  },
};

/** Null-safe instant comparison, so an unchanged air date is not a write. */
function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}
