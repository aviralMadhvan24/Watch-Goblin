import "server-only";

import { db } from "@/db/client";
import { Prisma } from "@/generated/prisma/client";

/**
 * Fuzzy catalogue search.
 *
 * Typing is the failure mode this exists for. `ILIKE '%q%'` finds "Attack on
 * Titan" from "titan" but not from "atack on titan", and a search box that
 * returns nothing for a one-character slip reads as a broken catalogue rather
 * than a typo.
 *
 * The fix is trigram similarity, added by the `pg_trgm` migration. Two details
 * decide which function to use:
 *
 *   similarity('naruto', 'Naruto Shippuden')       = 0.41   -- misses
 *   word_similarity('naruto', 'Naruto Shippuden')  = 1.00   -- matches
 *
 * `similarity` compares whole strings, so a short query against a long title
 * scores badly however well it matches. `word_similarity` scores the query
 * against the best-matching run of words inside the title, which is exactly
 * what a search box means. Every threshold below is a word-similarity score.
 */

/**
 * Minimum word similarity for a fuzzy hit.
 *
 * Calibrated against the real catalogue rather than picked round:
 *
 *   atack on titan  -> Attack on Titan  0.82
 *   jujutsu kaisan  -> Jujutsu Kaisen   0.80
 *   demn slayer     -> Demon Slayer     0.67
 *   one pece        -> One Piece        0.58
 *   brakingbad      -> Breaking Bad     0.46
 *
 * Postgres' own default is 0.6, which drops the last two — and "one pece" is
 * the kind of miss people actually make. 0.45 keeps them. False positives cost
 * little here because this query only ever runs when the exact search already
 * came back empty, so the alternative on screen is nothing at all.
 */
const FUZZY_THRESHOLD = 0.45;

/**
 * Fuzzy matching cannot use the trigram index — `word_similarity` is a
 * computed score, not a lookup — so this is a sequential scan over `shows`,
 * around 16ms at 1,800 rows and linear from there. Capping the candidate set
 * bounds the sort and the id list handed to Prisma afterwards. Nobody pages to
 * result 200 of a misspelled query.
 */
const MAX_FUZZY_CANDIDATES = 200;

export interface FuzzyMatch {
  id: string;
  score: number;
}

/**
 * Ids of shows whose title is *similar to* the query, best first.
 *
 * Returns ids rather than rows on purpose: the caller already owns the genre,
 * type and airing filters plus the card projection, and duplicating those in
 * raw SQL would mean two places to keep in step. This adds only the part
 * Prisma cannot express.
 */
export async function fuzzyShowIds(
  query: string,
  limit = MAX_FUZZY_CANDIDATES,
): Promise<FuzzyMatch[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  // `originalTitle` is compared without `coalesce` so the null case is a plain
  // IS NOT NULL test the planner can reason about, rather than a function call
  // wrapped around every row.
  const rows = await db.$queryRaw<{ id: string; score: number }[]>`
    SELECT
      s."id",
      GREATEST(
        word_similarity(${q}, s."title"),
        CASE
          WHEN s."originalTitle" IS NULL THEN 0
          ELSE word_similarity(${q}, s."originalTitle")
        END
      ) AS score
    FROM "shows" s
    WHERE word_similarity(${q}, s."title") >= ${FUZZY_THRESHOLD}
       OR (
         s."originalTitle" IS NOT NULL
         AND word_similarity(${q}, s."originalTitle") >= ${FUZZY_THRESHOLD}
       )
    ORDER BY score DESC, s."popularity" DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({ id: row.id, score: Number(row.score) }));
}

/**
 * The exact half of search, as a Prisma filter.
 *
 * Substring matching stays the primary path because it is what people
 * overwhelmingly do — they type part of a title correctly — and because the GIN
 * trigram indexes make `ILIKE '%q%'` an index lookup instead of a scan.
 */
export function exactSearchFilter(q: string): Prisma.ShowWhereInput {
  return {
    OR: [
      { title: { contains: q, mode: "insensitive" } },
      { originalTitle: { contains: q, mode: "insensitive" } },
    ],
  };
}

/**
 * Ranks a set of rows into the order `fuzzyShowIds` returned them.
 *
 * Necessary because `WHERE id IN (...)` discards ordering — Postgres returns
 * rows in whatever order it finds them, which for a relevance search is no
 * order at all.
 */
export function rankByFuzzyScore<T extends { id: string }>(
  rows: T[],
  matches: FuzzyMatch[],
): T[] {
  const rank = new Map(matches.map((match, index) => [match.id, index]));
  return [...rows].sort(
    (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}
