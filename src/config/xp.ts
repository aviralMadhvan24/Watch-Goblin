/**
 * The XP economy. Every award amount and the level curve live here so the
 * whole progression system can be retuned without touching business logic or
 * running a migration.
 *
 * Anti-abuse note: amounts are only half the story. Each award is written to
 * the `xp_events` ledger with a *stable* dedupe key (see `xpDedupeKey`), and
 * the ledger has a unique index on (userId, dedupeKey). Un-watching and
 * re-watching an episode therefore reuses the same key and grants nothing the
 * second time. XP is never removed when a fact is undone — it is a record of
 * things you did, not a live counter — which also removes any incentive to
 * toggle state repeatedly.
 */

import type { XpReason } from "@/generated/prisma/enums";

export const XP_AWARDS: Record<XpReason, number> = {
  EPISODE_WATCHED: 10,
  SEASON_COMPLETED: 100,
  SHOW_COMPLETED: 500,
  REVIEW_POSTED: 50,
  REVIEW_LIKED: 5,
  DAILY_STREAK: 20,
  ACHIEVEMENT_UNLOCKED: 0, // per-achievement, see Achievement.xpReward
  PROFILE_COMPLETED: 100,
};

/**
 * Level curve: cumulative XP needed to *reach* a level is
 *   BASE * (level - 1) ^ EXPONENT
 *
 * Chosen so the product's reference profile (≈347 shows, ≈1,284 episodes)
 * lands around level 27, and level 100 stays genuinely absurd (~8M XP).
 */
export const LEVEL_CURVE = {
  BASE: 80,
  EXPONENT: 2.5,
  MAX_LEVEL: 100,
} as const;

/** Ceiling on XP that can be earned from likes on a single review. */
export const REVIEW_LIKE_XP_CAP = 100;

/**
 * Stable dedupe keys. Two awards for the same underlying fact must produce the
 * same string, forever — changing these effectively re-opens old XP.
 */
export const xpDedupeKey = {
  episode: (episodeId: string) => `episode:${episodeId}`,
  season: (seasonId: string) => `season:${seasonId}`,
  show: (showId: string) => `show:${showId}`,
  review: (reviewId: string) => `review:${reviewId}`,
  /** One award per liker per review, so unlike/relike cannot farm. */
  reviewLike: (reviewId: string, likerId: string) => `review-like:${reviewId}:${likerId}`,
  /** One award per calendar day. */
  dailyStreak: (isoDate: string) => `streak:${isoDate}`,
  achievement: (achievementId: string) => `achievement:${achievementId}`,
  profileCompleted: () => "profile:completed",
} as const;
