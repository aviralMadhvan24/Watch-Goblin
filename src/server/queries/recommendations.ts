import "server-only";

import { db } from "@/db/client";
import { Prisma } from "@/generated/prisma/client";
import type { ShowType, WatchStatus } from "@/generated/prisma/enums";
import { showCardSelect, toShowCard, type ShowCardData } from "@/server/queries/shows";

/**
 * Recommendations.
 *
 * Content-led, with a collaborative boost — chosen from what the data actually
 * supports rather than from what sounds impressive. Pure collaborative
 * filtering needs overlapping libraries, and a young catalogue has a handful of
 * users against thousands of shows: most pairs of shows have never been watched
 * by the same person, so it can only ever speak about the small corner of the
 * catalogue that someone has already touched. Genres cover every show from the
 * moment it is imported.
 *
 * So: genre affinity decides the shortlist, co-watching reorders it where there
 * is enough signal to say anything, and provider rating breaks ties and carries
 * a brand-new account until it has a library worth reading.
 *
 * Every recommendation carries its reason. An unexplained suggestion is
 * indistinguishable from a random one, and users treat it as such.
 */

// -------------------------------------------------------------------------
// Weights
// -------------------------------------------------------------------------

/**
 * What a library entry says about taste, when the user has not rated it.
 *
 * Dropping something is the strongest *negative* signal available and is worth
 * keeping: without it, one abandoned genre keeps coming back forever. Plan-to-
 * watch counts for little — an intention is not yet an opinion.
 */
const STATUS_WEIGHT: Record<WatchStatus, number> = {
  REWATCHING: 1.25,
  COMPLETED: 1,
  WATCHING: 0.75,
  ON_HOLD: 0.25,
  PLAN_TO_WATCH: 0.25,
  DROPPED: -0.5,
};

/** Ratings are 0.5–5. Three stars is "fine", so it should move nothing. */
const NEUTRAL_RATING = 3;

/**
 * How the three signals combine.
 *
 * Genre affinity dominates because it is the only one with full catalogue
 * coverage. Quality is deliberately small: it decides ties and cold starts, and
 * any larger share would collapse every user's recommendations into the same
 * list of highly-rated shows.
 */
const WEIGHT_GENRE = 1;
const WEIGHT_COLLABORATIVE = 0.35;
const WEIGHT_QUALITY = 0.25;

/**
 * Tie-breaker, and only that.
 *
 * When someone's taste is broad, genre scores bunch together — a real user here
 * had six candidates inside 0.012 of each other — and whatever wins that tie is
 * effectively arbitrary. Left alone it surfaced shows nobody has heard of ahead
 * of Twin Peaks. Popularity is the cheapest signal for "this is a real show",
 * and at this weight it can only reorder shows the genre pass already
 * considered equivalent.
 */
const WEIGHT_POPULARITY = 0.15;

/**
 * Shortlist depth before the collaborative pass reorders it. Wider than the
 * page needs, so co-watching can promote something genre affinity ranked 40th.
 */
const CANDIDATE_POOL = 80;

// -------------------------------------------------------------------------
// Affinity
// -------------------------------------------------------------------------

export interface LibraryEntryForAffinity {
  showId: string;
  status: WatchStatus;
  rating: number | null;
  genreIds: string[];
}

export interface GenreAffinity {
  /** Genre id to taste weight, normalised so the strongest is ±1. */
  weights: Map<string, number>;
  /** Which of the user's shows drove each genre, strongest first. */
  drivers: Map<string, { showId: string; weight: number }[]>;
}

/**
 * Turns a library into a taste vector over genres.
 *
 * Kept pure and exported so it can be tested without a database — this is the
 * part where a wrong sign or a missing normalisation produces recommendations
 * that look plausible and are quietly backwards.
 */
export function buildGenreAffinity(
  entries: LibraryEntryForAffinity[],
  genreIdf: Map<string, number>,
): GenreAffinity {
  const totals = new Map<string, number>();
  const drivers = new Map<string, { showId: string; weight: number }[]>();

  for (const entry of entries) {
    if (entry.genreIds.length === 0) continue;

    // An explicit rating beats inferred behaviour: finishing a show you rated
    // two stars is not an endorsement of its genres.
    const opinion =
      entry.rating !== null
        ? (entry.rating - NEUTRAL_RATING) / 2
        : STATUS_WEIGHT[entry.status];

    if (opinion === 0) continue;

    // Split across the show's genres so a six-genre show does not count six
    // times as hard as a focused one.
    const perGenre = opinion / entry.genreIds.length;

    for (const genreId of entry.genreIds) {
      totals.set(genreId, (totals.get(genreId) ?? 0) + perGenre);

      const list = drivers.get(genreId) ?? [];
      list.push({ showId: entry.showId, weight: perGenre });
      drivers.set(genreId, list);
    }
  }

  // Rarity weighting. "Animation" sits on most of this catalogue, so sharing it
  // says almost nothing; "Mystery" sits on a fraction, so sharing it says a
  // great deal. Without this every anime fan is recommended every anime.
  for (const [genreId, total] of totals) {
    totals.set(genreId, total * (genreIdf.get(genreId) ?? 1));
  }

  // Normalise to ±1 so the weights below mean the same thing for a user with
  // 5 shows and a user with 500.
  const peak = Math.max(...[...totals.values()].map(Math.abs), 1e-9);
  for (const [genreId, total] of totals) totals.set(genreId, total / peak);

  for (const list of drivers.values()) list.sort((a, b) => b.weight - a.weight);

  return { weights: totals, drivers };
}

/**
 * Inverse document frequency per genre: `ln(totalShows / showsInGenre)`.
 *
 * Recomputed per request rather than cached — it is one grouped count over a
 * join table, and a stale value here silently skews every recommendation.
 */
export async function getGenreIdf(): Promise<Map<string, number>> {
  const [total, rows] = await Promise.all([
    db.show.count(),
    db.showGenre.groupBy({ by: ["genreId"], _count: { _all: true } }),
  ]);

  const idf = new Map<string, number>();
  if (total === 0) return idf;

  for (const row of rows) {
    const count = row._count._all || 1;
    // Floored at zero: a genre on literally every show carries no information,
    // and a negative weight would actively invert its meaning.
    idf.set(row.genreId, Math.max(0, Math.log(total / count)));
  }

  return idf;
}

// -------------------------------------------------------------------------
// Recommendations
// -------------------------------------------------------------------------

export interface Recommendation {
  show: ShowCardData;
  score: number;
  /** Human-readable justification, shown on the card. */
  reason: string;
}

/**
 * Personalised recommendations for one user.
 *
 * Falls back to a quality-and-popularity list when there is nothing to read —
 * a new account gets "what everyone is watching", which is the honest answer to
 * "we do not know you yet".
 */
export async function getRecommendations(
  userId: string,
  limit = 12,
): Promise<Recommendation[]> {
  const library = await db.userShow.findMany({
    where: { userId },
    select: {
      showId: true,
      status: true,
      rating: true,
      show: {
        select: {
          title: true,
          genres: { select: { genreId: true } },
        },
      },
    },
  });

  const excludeIds = library.map((row) => row.showId);

  if (library.length === 0) {
    return coldStart(limit);
  }

  const idf = await getGenreIdf();
  const affinity = buildGenreAffinity(
    library.map((row) => ({
      showId: row.showId,
      status: row.status,
      rating: row.rating,
      genreIds: row.show.genres.map((g) => g.genreId),
    })),
    idf,
  );

  // Only positive genres seed the search. Negative ones still matter, but as a
  // penalty applied to whatever surfaces — searching *for* disliked genres to
  // then subtract them would be a large query answering a question nobody asked.
  const liked = [...affinity.weights.entries()].filter(([, weight]) => weight > 0.05);
  if (liked.length === 0) return coldStart(limit, excludeIds);

  const candidates = await scoreCandidates(liked, excludeIds, CANDIDATE_POOL);
  if (candidates.length === 0) return coldStart(limit, excludeIds);

  const collaborative = await coWatchScores(
    userId,
    candidates.map((c) => c.id),
  );

  const genreNames = await genreNamesFor(candidates.flatMap((c) => c.genreIds));

  // Same opinion scale `buildGenreAffinity` uses, so the show cited as the
  // reason is one the user demonstrably liked rather than merely one they
  // logged.
  const sources: ReasonSource[] = library.map((row) => ({
    title: row.show.title,
    genreIds: new Set(row.show.genres.map((g) => g.genreId)),
    opinion:
      row.rating !== null ? (row.rating - NEUTRAL_RATING) / 2 : STATUS_WEIGHT[row.status],
  }));

  const scored = candidates.map((candidate) => {
    // Penalty pass: a candidate carrying a genre the user has actively dropped
    // gets pushed down rather than filtered out — one bad genre on a six-genre
    // show is not disqualifying.
    const negative = candidate.genreIds.reduce((sum, genreId) => {
      const weight = affinity.weights.get(genreId) ?? 0;
      return weight < 0 ? sum + weight : sum;
    }, 0);

    const collab = collaborative.get(candidate.id) ?? 0;

    const score =
      candidate.genreScore * WEIGHT_GENRE +
      collab * WEIGHT_COLLABORATIVE +
      candidate.quality * WEIGHT_QUALITY +
      candidate.popularity * WEIGHT_POPULARITY +
      // Same normalisation as the positive term, so a disliked genre subtracts
      // on the scale the rest of the score is measured in.
      negative / Math.sqrt(Math.max(candidate.genreIds.length, 1));

    return {
      show: toShowCard(candidate.row),
      score,
      reason: explain(candidate, affinity, collab, sources, genreNames, idf),
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

interface Candidate {
  id: string;
  genreScore: number;
  quality: number;
  /** Log-scaled to 0–1; see `scoreCandidates` for why it is not linear. */
  popularity: number;
  genreIds: string[];
  row: Parameters<typeof toShowCard>[0];
}

/**
 * Scores the catalogue against a taste vector, in one query.
 *
 * The weights travel into SQL as a VALUES list and join against `show_genres`,
 * so the database only ever touches shows that share a genre the user likes —
 * rather than the alternative of loading every show-genre pair into memory and
 * scoring there, which is fine at two thousand shows and hopeless at a hundred
 * thousand.
 */
async function scoreCandidates(
  liked: [string, number][],
  excludeIds: string[],
  limit: number,
): Promise<Candidate[]> {
  const weights = Prisma.join(
    liked.map(([genreId, weight]) => Prisma.sql`(${genreId}, ${weight}::double precision)`),
  );

  const exclusion =
    excludeIds.length > 0
      ? Prisma.sql`AND s."id" NOT IN (${Prisma.join(excludeIds)})`
      : Prisma.empty;

  const rows = await db.$queryRaw<
    { id: string; genre_score: number; quality: number; popularity: number }[]
  >`
    WITH affinity(genre_id, weight) AS (VALUES ${weights}),
    matched AS (
      SELECT sg."showId" AS show_id, SUM(a.weight) AS raw
      FROM "show_genres" sg
      JOIN affinity a ON a.genre_id = sg."genreId"
      GROUP BY sg."showId"
    ),
    sized AS (
      SELECT "showId" AS show_id, COUNT(*)::double precision AS genre_count
      FROM "show_genres"
      GROUP BY "showId"
    )
    SELECT
      s."id",
      -- Divided by the SQUARE ROOT of the genre count, not the count itself.
      --
      -- The plain mean looks right and is not: it hands a show tagged with a
      -- single genre that genre's entire weight, so a one-tag show beats one
      -- that matches on three. That is not hypothetical — it recommended
      -- Judge Judy ("Crime") to someone whose taste was built from Breaking
      -- Bad. Dividing by the sum instead over-rewards breadth, which is the
      -- opposite failure. The square root sits between them: matching more
      -- genres still wins, but carrying unmatched ones still costs.
      (m.raw / SQRT(GREATEST(z.genre_count, 1))) AS genre_score,
      -- Provider rating recentred so the catalogue average lands near zero and
      -- only genuinely well-regarded shows get a lift.
      ((COALESCE(s."externalRating", 7.0) - 7.0) / 3.0) AS quality,
      -- Log-scaled, because popularity is violently long-tailed: this
      -- catalogue averages 34 and peaks at 573, so a linear term would let one
      -- blockbuster outrank everything on taste. The log keeps "known" and
      -- "unknown" distinguishable without making "most known" decisive.
      (LN(1 + GREATEST(s."popularity", 0)) / LN(1 + 1000)) AS popularity
    FROM matched m
    JOIN sized z ON z.show_id = m.show_id
    JOIN "shows" s ON s."id" = m.show_id
    WHERE s."totalEpisodes" > 0
      ${exclusion}
    ORDER BY
      (m.raw / SQRT(GREATEST(z.genre_count, 1))) DESC,
      s."popularity" DESC
    LIMIT ${limit}
  `;

  if (rows.length === 0) return [];

  const shows = await db.show.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    select: { ...showCardSelect, genres: { select: { genreId: true } } },
  });

  const byId = new Map(shows.map((show) => [show.id, show]));

  return rows.flatMap((row) => {
    const show = byId.get(row.id);
    if (!show) return [];

    const { genres, ...card } = show;
    return [
      {
        id: row.id,
        genreScore: Number(row.genre_score),
        quality: Number(row.quality),
        popularity: Math.min(1, Number(row.popularity)),
        genreIds: genres.map((g) => g.genreId),
        row: card,
      },
    ];
  });
}

/**
 * "People who watched what you watch also watched this."
 *
 * Neighbours are users sharing at least one show; the score is the share of
 * those neighbours who hold the candidate. Returned normalised to 0–1 so its
 * weight above means the same thing regardless of how many users exist.
 *
 * This is the signal that grows as the product does. Today it barely moves the
 * ordering; with a few thousand libraries it becomes the interesting half.
 */
async function coWatchScores(
  userId: string,
  candidateIds: string[],
): Promise<Map<string, number>> {
  if (candidateIds.length === 0) return new Map();

  const rows = await db.$queryRaw<{ show_id: string; score: number }[]>`
    WITH mine AS (
      SELECT "showId" FROM "user_shows" WHERE "userId" = ${userId}
    ),
    neighbours AS (
      SELECT DISTINCT us."userId"
      FROM "user_shows" us
      JOIN mine ON mine."showId" = us."showId"
      WHERE us."userId" <> ${userId}
    )
    SELECT
      us."showId" AS show_id,
      COUNT(DISTINCT us."userId")::double precision
        / GREATEST((SELECT COUNT(*) FROM neighbours), 1) AS score
    FROM "user_shows" us
    JOIN neighbours n ON n."userId" = us."userId"
    WHERE us."showId" IN (${Prisma.join(candidateIds)})
      -- A neighbour who dropped it is not endorsing it.
      AND us."status" <> 'DROPPED'
    GROUP BY us."showId"
  `;

  return new Map(rows.map((row) => [row.show_id, Number(row.score)]));
}

async function genreNamesFor(genreIds: string[]): Promise<Map<string, string>> {
  if (genreIds.length === 0) return new Map();

  const rows = await db.genre.findMany({
    where: { id: { in: [...new Set(genreIds)] } },
    select: { id: true, name: true },
  });

  return new Map(rows.map((row) => [row.id, row.name]));
}

/** One show from the user's library, reduced to what explanations need. */
export interface ReasonSource {
  title: string;
  genreIds: Set<string>;
  /** Positive for shows they liked; only those are ever cited. */
  opinion: number;
}

/**
 * Why this show is here.
 *
 * Names an actual show wherever possible, because "because you watched
 * Frieren" is checkable and "because you like Animation" is not.
 *
 * The show it names is chosen *per candidate*, by rarity-weighted genre
 * overlap. Naming the single strongest genre's top driver instead is cheaper
 * and looks fine in isolation, but it puts the same sentence on every card —
 * six recommendations all claiming to be "because you watched Stranger Things"
 * reads as a template, not a reason, and the page stops being believable.
 */
function explain(
  candidate: Candidate,
  affinity: GenreAffinity,
  collaborative: number,
  sources: ReasonSource[],
  genreNames: Map<string, string>,
  idf: Map<string, number>,
): string {
  const candidateGenres = candidate.genreIds;

  let best: { title: string; overlap: number } | null = null;

  for (const source of sources) {
    if (source.opinion <= 0) continue;

    // Rarity-weighted overlap: sharing "Mystery" is evidence, sharing
    // "Animation" in an anime-heavy catalogue is barely anything.
    let overlap = 0;
    for (const genreId of candidateGenres) {
      if (source.genreIds.has(genreId)) overlap += idf.get(genreId) ?? 1;
    }
    if (overlap === 0) continue;

    // Scaled by how much they liked it, so a five-star show outranks one they
    // merely finished when both overlap equally.
    const strength = overlap * source.opinion;
    if (!best || strength > best.overlap) best = { title: source.title, overlap: strength };
  }

  if (best) return `Because you watched ${best.title}`;

  if (collaborative > 0.25) return "Popular with people who watch what you watch";

  const strongestGenre = candidateGenres
    .map((genreId) => ({ genreId, weight: affinity.weights.get(genreId) ?? 0 }))
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight)[0];

  if (strongestGenre) {
    const name = genreNames.get(strongestGenre.genreId);
    if (name) return `More ${name.toLowerCase()}, which you keep coming back to`;
  }

  return "Highly rated and close to your taste";
}

/**
 * No library, or nothing readable in it: well-regarded and widely watched.
 *
 * `ratingCount` is deliberately not used to rank — only 49 shows in this
 * catalogue carry a community rating, so leading with it would recommend the
 * same handful of shows to everyone forever.
 */
async function coldStart(limit: number, excludeIds: string[] = []): Promise<Recommendation[]> {
  const rows = await db.show.findMany({
    where: {
      totalEpisodes: { gt: 0 },
      externalRating: { gte: 7.5 },
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    },
    orderBy: [{ popularity: "desc" }],
    take: limit,
    select: showCardSelect,
  });

  return rows.map((row) => ({
    show: toShowCard(row),
    score: 0,
    reason: "Popular right now",
  }));
}

// -------------------------------------------------------------------------
// Similar shows
// -------------------------------------------------------------------------

/**
 * "More like this" for a show page. Needs no user, so it works signed out.
 *
 * Similarity is shared genres weighted by rarity, plus a bonus for a shared
 * studio or network — which in practice is what makes two anime feel alike far
 * more than a shared "Action & Adventure" tag does.
 */
export async function getSimilarShows(
  showId: string,
  type: ShowType,
  limit = 6,
): Promise<ShowCardData[]> {
  const idf = await getGenreIdf();

  const source = await db.show.findUnique({
    where: { id: showId },
    select: {
      genres: { select: { genreId: true } },
      credits: { select: { creditId: true } },
    },
  });

  if (!source || source.genres.length === 0) return [];

  const weights = Prisma.join(
    source.genres.map((g) =>
      Prisma.sql`(${g.genreId}, ${idf.get(g.genreId) ?? 1}::double precision)`,
    ),
  );

  const creditFilter =
    source.credits.length > 0
      ? Prisma.sql`(SELECT COUNT(*) FROM "show_credits" sc
                    WHERE sc."showId" = s."id"
                      AND sc."creditId" IN (${Prisma.join(source.credits.map((c) => c.creditId))}))`
      : Prisma.sql`0`;

  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH affinity(genre_id, weight) AS (VALUES ${weights}),
    matched AS (
      SELECT sg."showId" AS show_id, SUM(a.weight) AS raw
      FROM "show_genres" sg
      JOIN affinity a ON a.genre_id = sg."genreId"
      GROUP BY sg."showId"
    ),
    sized AS (
      SELECT "showId" AS show_id, COUNT(*)::double precision AS genre_count
      FROM "show_genres"
      GROUP BY "showId"
    )
    SELECT s."id"
    FROM matched m
    JOIN sized z ON z.show_id = m.show_id
    JOIN "shows" s ON s."id" = m.show_id
    WHERE s."id" <> ${showId}
      AND s."totalEpisodes" > 0
      -- Same medium: an anime fan looking at an anime does not want a US
      -- procedural back, however many genre tags happen to line up.
      AND s."type" = ${type}::"ShowType"
    ORDER BY
      (m.raw / SQRT(GREATEST(z.genre_count, 1))) + (${creditFilter} * 0.15) DESC,
      s."popularity" DESC
    LIMIT ${limit}
  `;

  if (rows.length === 0) return [];

  const shows = await db.show.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    select: showCardSelect,
  });

  // Restore the relevance order that `IN (...)` discarded.
  const rank = new Map(rows.map((row, index) => [row.id, index]));
  return shows
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
    .map(toShowCard);
}
