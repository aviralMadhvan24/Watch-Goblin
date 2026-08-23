import "server-only";

import { db, type DbClient } from "@/db/client";
import { xpToLevel } from "@/lib/leveling";
import { logger } from "@/lib/logger";

/**
 * The denormalised-counter service.
 *
 * `user_stats` exists so a profile page, a leaderboard row and a comparison
 * screen are all single indexed reads instead of aggregations over a user's
 * entire history. That is only safe if exactly one place is allowed to write
 * those columns — this file — and only ever inside the transaction that
 * produced the underlying change.
 *
 * `recompute` is the safety net: because every counter is derived from facts
 * that are still in the database (user_shows, user_episodes, follows, ...),
 * any drift can be repaired without data loss. The integration tests use it to
 * assert that the incremental path and the authoritative path agree.
 */

/** Counter deltas. Omitted keys are left alone. */
export interface StatDelta {
  showsCompleted?: number;
  animeCompleted?: number;
  tvCompleted?: number;
  seasonsCompleted?: number;
  episodesWatched?: number;
  minutesWatched?: number;
  watching?: number;
  planToWatch?: number;
  onHold?: number;
  dropped?: number;
  rewatching?: number;
  reviewsPosted?: number;
  reviewLikesReceived?: number;
  followersCount?: number;
  followingCount?: number;
}

/** Ranks change roughly never, so they are cached briefly per process. */
interface CachedRanks {
  rows: { id: string; minLevel: number }[];
  expiresAt: number;
}
let rankCache: CachedRanks | null = null;
const RANK_CACHE_TTL_MS = 5 * 60_000;

export const statsService = {
  /** Drops the rank cache. Call after an admin edits ranks. */
  invalidateRankCache() {
    rankCache = null;
  },

  async getRanks(client: DbClient = db) {
    if (rankCache && rankCache.expiresAt > Date.now()) return rankCache.rows;

    const rows = await client.rank.findMany({
      select: { id: true, minLevel: true },
      orderBy: { minLevel: "asc" },
    });

    rankCache = { rows, expiresAt: Date.now() + RANK_CACHE_TTL_MS };
    return rows;
  },

  /** The highest rank whose `minLevel` the user has reached. */
  async resolveRankId(client: DbClient, level: number): Promise<string | null> {
    const ranks = await this.getRanks(client);
    let match: string | null = null;
    for (const rank of ranks) {
      if (rank.minLevel <= level) match = rank.id;
      else break;
    }
    return match;
  },

  /** Re-resolves level and rank from an XP total. */
  async refreshRank(client: DbClient, userId: string, xpTotal: number): Promise<number> {
    const level = xpToLevel(xpTotal);
    const rankId = await this.resolveRankId(client, level);

    await client.userStats.update({
      where: { userId },
      data: { level, rankId },
    });

    return level;
  },

  /**
   * Applies counter deltas. Uses `increment` rather than read-modify-write so
   * two concurrent episode marks cannot clobber each other's counts.
   */
  async applyDelta(client: DbClient, userId: string, delta: StatDelta): Promise<void> {
    const data: Record<string, { increment: number }> = {};
    for (const [key, value] of Object.entries(delta)) {
      if (typeof value === "number" && value !== 0) data[key] = { increment: value };
    }
    if (Object.keys(data).length === 0) return;

    await client.userStats.update({ where: { userId }, data });
  },

  async ensureExists(client: DbClient, userId: string): Promise<void> {
    await client.userStats.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    await client.watchStreak.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  },

  /**
   * Rebuilds every counter from the underlying facts. O(user's history), so it
   * is a maintenance and test operation — never on a request path.
   */
  async recompute(userId: string, client: DbClient = db): Promise<void> {
    const [byStatus, episodeAgg, seasonAgg, reviews, likes, followers, following, xp, streak] =
      await Promise.all([
        client.userShow.groupBy({
          by: ["status"],
          where: { userId },
          _count: { _all: true },
        }),
        client.userShow.aggregate({
          where: { userId },
          _sum: { episodesWatched: true, minutesWatched: true },
        }),
        client.userShow.aggregate({
          where: { userId },
          _sum: { seasonsCompleted: true },
        }),
        client.review.count({ where: { userId, deletedAt: null } }),
        client.reviewLike.count({ where: { review: { userId, deletedAt: null } } }),
        client.follow.count({ where: { followingId: userId } }),
        client.follow.count({ where: { followerId: userId } }),
        client.xpEvent.aggregate({ where: { userId }, _sum: { amount: true } }),
        client.watchStreak.findUnique({
          where: { userId },
          select: { current: true, longest: true },
        }),
      ]);

    const countFor = (status: string) =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;

    // Anime/TV completion counts need the show type, so they are counted
    // separately rather than inferred from the status grouping.
    const [animeCompleted, tvCompleted] = await Promise.all([
      client.userShow.count({ where: { userId, status: "COMPLETED", show: { type: "ANIME" } } }),
      client.userShow.count({ where: { userId, status: "COMPLETED", show: { type: "TV" } } }),
    ]);

    const xpTotal = xp._sum.amount ?? 0;
    const level = xpToLevel(xpTotal);
    const rankId = await this.resolveRankId(client, level);

    await client.userStats.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    await client.userStats.update({
      where: { userId },
      data: {
        showsCompleted: countFor("COMPLETED"),
        animeCompleted,
        tvCompleted,
        seasonsCompleted: seasonAgg._sum.seasonsCompleted ?? 0,
        episodesWatched: episodeAgg._sum.episodesWatched ?? 0,
        minutesWatched: episodeAgg._sum.minutesWatched ?? 0,
        watching: countFor("WATCHING"),
        planToWatch: countFor("PLAN_TO_WATCH"),
        onHold: countFor("ON_HOLD"),
        dropped: countFor("DROPPED"),
        rewatching: countFor("REWATCHING"),
        reviewsPosted: reviews,
        reviewLikesReceived: likes,
        followersCount: followers,
        followingCount: following,
        xpTotal,
        level,
        rankId,
        currentStreak: streak?.current ?? 0,
        longestStreak: streak?.longest ?? 0,
      },
    });

    logger.debug("Recomputed user stats", { userId, xpTotal, level });
  },
};
