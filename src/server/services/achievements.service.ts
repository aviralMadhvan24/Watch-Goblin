import "server-only";

import { xpDedupeKey } from "@/config/xp";
import type { DbClient } from "@/db/client";
import type { AchievementMetric } from "@/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { xpService } from "@/server/services/xp.service";

/**
 * Achievement evaluation.
 *
 * Every achievement is `metric >= threshold`, so there is one evaluator rather
 * than one function per achievement. Adding an achievement is inserting a row;
 * the only code change a genuinely new *kind* of achievement needs is a new
 * `AchievementMetric` value and a line in `collectMetrics`.
 *
 * Evaluation runs inside the caller's transaction so an unlock, its XP and the
 * activity that announced it either all land or none do.
 */

export interface UnlockedAchievement {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  xpReward: number;
}

/**
 * Every metric the catalogue can test, in one read. Most come straight off
 * `user_stats`; only `EPISODES_IN_ONE_DAY` needs its own query, and that one
 * hits the pre-aggregated `daily_watch_logs` rather than scanning episodes.
 */
async function collectMetrics(
  tx: DbClient,
  userId: string,
): Promise<Record<AchievementMetric, number>> {
  const stats = await tx.userStats.findUnique({
    where: { userId },
    select: {
      showsCompleted: true,
      animeCompleted: true,
      tvCompleted: true,
      episodesWatched: true,
      seasonsCompleted: true,
      minutesWatched: true,
      currentStreak: true,
      longestStreak: true,
      reviewsPosted: true,
      reviewLikesReceived: true,
      followersCount: true,
      level: true,
    },
  });

  const bestDay = await tx.dailyWatchLog.findFirst({
    where: { userId },
    orderBy: { episodesWatched: "desc" },
    select: { episodesWatched: true },
  });

  return {
    SHOWS_COMPLETED: stats?.showsCompleted ?? 0,
    ANIME_COMPLETED: stats?.animeCompleted ?? 0,
    TV_COMPLETED: stats?.tvCompleted ?? 0,
    EPISODES_WATCHED: stats?.episodesWatched ?? 0,
    SEASONS_COMPLETED: stats?.seasonsCompleted ?? 0,
    MINUTES_WATCHED: stats?.minutesWatched ?? 0,
    EPISODES_IN_ONE_DAY: bestDay?.episodesWatched ?? 0,
    CURRENT_STREAK: stats?.currentStreak ?? 0,
    LONGEST_STREAK: stats?.longestStreak ?? 0,
    REVIEWS_POSTED: stats?.reviewsPosted ?? 0,
    REVIEW_LIKES_RECEIVED: stats?.reviewLikesReceived ?? 0,
    FOLLOWERS: stats?.followersCount ?? 0,
    LEVEL: stats?.level ?? 1,
  };
}

/**
 * Unlocking pays XP, which can raise the level, which can satisfy a LEVEL
 * achievement. Rather than recurse, evaluation repeats a bounded number of
 * times until nothing new unlocks.
 */
const MAX_CASCADE_PASSES = 3;

export const achievementsService = {
  /**
   * Unlocks everything the user now qualifies for and returns what was newly
   * unlocked, so the caller can toast it and write activity rows.
   */
  async evaluate(tx: DbClient, userId: string): Promise<UnlockedAchievement[]> {
    const unlocked: UnlockedAchievement[] = [];

    for (let pass = 0; pass < MAX_CASCADE_PASSES; pass++) {
      const metrics = await collectMetrics(tx, userId);

      const owned = await tx.userAchievement.findMany({
        where: { userId },
        select: { achievementId: true },
      });
      const ownedIds = new Set(owned.map((row) => row.achievementId));

      const candidates = await tx.achievement.findMany({
        where: { id: { notIn: ownedIds.size ? [...ownedIds] : ["__none__"] } },
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          icon: true,
          metric: true,
          threshold: true,
          xpReward: true,
        },
      });

      const newlyQualified = candidates.filter(
        (achievement) => metrics[achievement.metric] >= achievement.threshold,
      );

      if (newlyQualified.length === 0) break;

      for (const achievement of newlyQualified) {
        try {
          await tx.userAchievement.create({
            data: {
              userId,
              achievementId: achievement.id,
              valueAtUnlock: metrics[achievement.metric],
            },
          });
        } catch (error) {
          // Unique violation: another concurrent write unlocked it first.
          if (isUniqueViolation(error)) continue;
          throw error;
        }

        if (achievement.xpReward > 0) {
          await xpService.award(
            tx,
            userId,
            "ACHIEVEMENT_UNLOCKED",
            xpDedupeKey.achievement(achievement.id),
            { amount: achievement.xpReward, payload: { code: achievement.code } },
          );
        }

        unlocked.push({
          id: achievement.id,
          code: achievement.code,
          name: achievement.name,
          description: achievement.description,
          icon: achievement.icon,
          xpReward: achievement.xpReward,
        });

        logger.info("Achievement unlocked", { userId, code: achievement.code });
      }
    }

    return unlocked;
  },

  /** Everything the user has, newest first. */
  async listForUser(tx: DbClient, userId: string) {
    return tx.userAchievement.findMany({
      where: { userId },
      orderBy: { unlockedAt: "desc" },
      select: {
        unlockedAt: true,
        valueAtUnlock: true,
        achievement: {
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            icon: true,
            category: true,
            xpReward: true,
          },
        },
      },
    });
  },

  /**
   * The full catalogue with per-user progress, for the achievements page.
   * Secret achievements stay hidden until unlocked.
   */
  async listProgressForUser(tx: DbClient, userId: string) {
    const [all, owned, metrics] = await Promise.all([
      tx.achievement.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { threshold: "asc" }] }),
      tx.userAchievement.findMany({
        where: { userId },
        select: { achievementId: true, unlockedAt: true },
      }),
      collectMetrics(tx, userId),
    ]);

    const unlockedAt = new Map(owned.map((row) => [row.achievementId, row.unlockedAt]));

    return all
      .filter((achievement) => !achievement.isSecret || unlockedAt.has(achievement.id))
      .map((achievement) => {
        const value = metrics[achievement.metric];
        return {
          id: achievement.id,
          code: achievement.code,
          name: achievement.name,
          description: achievement.description,
          icon: achievement.icon,
          category: achievement.category,
          xpReward: achievement.xpReward,
          threshold: achievement.threshold,
          value: Math.min(value, achievement.threshold),
          progress: achievement.threshold > 0 ? Math.min(1, value / achievement.threshold) : 0,
          unlockedAt: unlockedAt.get(achievement.id) ?? null,
        };
      });
  },
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
