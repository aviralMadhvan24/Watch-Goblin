import "server-only";

import type { DbClient } from "@/db/client";
import type { ActivityType, Visibility } from "@/generated/prisma/enums";

/**
 * The activity log.
 *
 * Rows are written with the actor's *current* activity visibility baked in.
 * That is a deliberate trade: it means the feed query filters on a single
 * indexed column instead of joining every row back to its author's privacy
 * settings, and it matches how people expect these settings to behave — making
 * your account private hides what you do from now on, it does not retroactively
 * rewrite what your followers already saw.
 *
 * Display text is denormalised into `payload` so rendering a 50-item feed does
 * not fan out into 50 show lookups.
 */

export interface ActivityInput {
  userId: string;
  type: ActivityType;
  showId?: string | null;
  reviewId?: string | null;
  targetUserId?: string | null;
  achievementId?: string | null;
  payload?: Record<string, unknown>;
  /** Overrides the actor's default activity visibility. */
  visibility?: Visibility;
}

export const activityService = {
  async record(tx: DbClient, input: ActivityInput): Promise<void> {
    const visibility =
      input.visibility ??
      (
        await tx.profile.findUnique({
          where: { userId: input.userId },
          select: { activityVisibility: true },
        })
      )?.activityVisibility ??
      "PUBLIC";

    await tx.activity.create({
      data: {
        userId: input.userId,
        type: input.type,
        showId: input.showId ?? null,
        reviewId: input.reviewId ?? null,
        targetUserId: input.targetUserId ?? null,
        achievementId: input.achievementId ?? null,
        payload: (input.payload ?? {}) as never,
        visibility,
      },
    });
  },

  /**
   * Writes several activities with one visibility lookup. The tracking flow can
   * emit episode + season + show + level-up in a single click, and this keeps
   * that to one extra query rather than four.
   */
  async recordMany(tx: DbClient, userId: string, entries: Omit<ActivityInput, "userId">[]) {
    if (entries.length === 0) return;

    const visibility =
      (
        await tx.profile.findUnique({
          where: { userId },
          select: { activityVisibility: true },
        })
      )?.activityVisibility ?? "PUBLIC";

    await tx.activity.createMany({
      data: entries.map((entry) => ({
        userId,
        type: entry.type,
        showId: entry.showId ?? null,
        reviewId: entry.reviewId ?? null,
        targetUserId: entry.targetUserId ?? null,
        achievementId: entry.achievementId ?? null,
        payload: (entry.payload ?? {}) as never,
        visibility: entry.visibility ?? visibility,
      })),
    });
  },
};
