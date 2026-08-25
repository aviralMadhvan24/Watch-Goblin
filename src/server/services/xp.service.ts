import "server-only";

import { XP_AWARDS } from "@/config/xp";
import type { DbClient } from "@/db/client";
import type { XpReason } from "@/generated/prisma/enums";
import { xpToLevel } from "@/lib/leveling";
import { logger } from "@/lib/logger";
import { statsService } from "@/server/services/stats.service";

/**
 * XP awards.
 *
 * The anti-farming design, in one place:
 *
 *  - Every award is an immutable row in `xp_events` with a caller-supplied
 *    `dedupeKey`, and the table has a unique index on (userId, dedupeKey).
 *  - The insert goes in as ON CONFLICT DO NOTHING. If it inserts nothing, this
 *    action has already paid out and we return `{ awarded: false }` without
 *    touching any counter. That check is the database's, not the
 *    application's, so it holds under concurrency too — two simultaneous marks
 *    of the same episode cannot both win. It must stay a conflict-tolerant
 *    insert rather than a `create` in a try/catch: a raised unique violation
 *    aborts the surrounding Postgres transaction, and no amount of catching in
 *    JS brings it back.
 *  - XP is never revoked. Un-marking an episode rolls back the *progress*
 *    counters, but the ledger row stays. Combined with the stable dedupe key,
 *    that removes any reason to toggle: the first mark is the only one that
 *    ever pays, and undoing it does not refund the opportunity.
 *
 * `xpTotal` on `user_stats` is a cache of `SUM(xp_events.amount)`, so
 * `statsService.recompute` can always rebuild it from the ledger.
 */

export interface XpAwardResult {
  awarded: boolean;
  amount: number;
  xpTotal: number;
  previousLevel: number;
  level: number;
  leveledUp: boolean;
}


export const xpService = {
  /**
   * Grants XP once for a given `dedupeKey`. Must run inside the same
   * transaction as the fact it rewards, so XP and progress commit together.
   */
  async award(
    tx: DbClient,
    userId: string,
    reason: XpReason,
    dedupeKey: string,
    options?: { amount?: number; payload?: Record<string, unknown> },
  ): Promise<XpAwardResult> {
    const amount = options?.amount ?? XP_AWARDS[reason];

    const stats = await tx.userStats.findUnique({
      where: { userId },
      select: { xpTotal: true, level: true },
    });
    const previousXp = stats?.xpTotal ?? 0;
    const previousLevel = stats?.level ?? xpToLevel(previousXp);

    if (amount <= 0) {
      return {
        awarded: false,
        amount: 0,
        xpTotal: previousXp,
        previousLevel,
        level: previousLevel,
        leveledUp: false,
      };
    }

    // `createMany({ skipDuplicates })` compiles to ON CONFLICT DO NOTHING, so a
    // repeat award is a no-op that returns count 0 rather than an error.
    //
    // This must not be a `create` in a try/catch. In Postgres a failed statement
    // aborts the whole transaction: catching the unique violation in JS does not
    // un-abort it, and every later query on `tx` then dies with 25P02
    // ("current transaction is aborted"). Since the dedupe key is *designed* to
    // collide — re-marking an episode whose XP was already paid is the normal
    // case — that turned an expected no-op into a failed write.
    const created = await tx.xpEvent.createMany({
      data: [
        {
          userId,
          amount,
          reason,
          dedupeKey,
          payload: (options?.payload ?? {}) as never,
        },
      ],
      skipDuplicates: true,
    });

    if (created.count === 0) {
      // Already paid out for this exact action. Not an error — the expected
      // outcome of re-marking something.
      return {
        awarded: false,
        amount: 0,
        xpTotal: previousXp,
        previousLevel,
        level: previousLevel,
        leveledUp: false,
      };
    }

    const updated = await tx.userStats.update({
      where: { userId },
      data: { xpTotal: { increment: amount } },
      select: { xpTotal: true },
    });

    const level = await statsService.refreshRank(tx, userId, updated.xpTotal);

    if (level > previousLevel) {
      logger.info("User levelled up", { userId, previousLevel, level });
    }

    return {
      awarded: true,
      amount,
      xpTotal: updated.xpTotal,
      previousLevel,
      level,
      leveledUp: level > previousLevel,
    };
  },

  /**
   * Awards several things at once, reporting the combined outcome. Used by the
   * tracking flow, where one click can mean episode + season + show XP.
   */
  async awardMany(
    tx: DbClient,
    userId: string,
    awards: {
      reason: XpReason;
      dedupeKey: string;
      amount?: number;
      payload?: Record<string, unknown>;
    }[],
  ): Promise<{ totalAwarded: number; leveledUp: boolean; level: number; xpTotal: number }> {
    let totalAwarded = 0;
    let leveledUp = false;
    let level = 0;
    let xpTotal = 0;

    for (const award of awards) {
      const result = await this.award(tx, userId, award.reason, award.dedupeKey, {
        amount: award.amount,
        payload: award.payload,
      });
      totalAwarded += result.amount;
      leveledUp = leveledUp || result.leveledUp;
      level = result.level;
      xpTotal = result.xpTotal;
    }

    if (level === 0) {
      const stats = await tx.userStats.findUnique({
        where: { userId },
        select: { level: true, xpTotal: true },
      });
      level = stats?.level ?? 1;
      xpTotal = stats?.xpTotal ?? 0;
    }

    return { totalAwarded, leveledUp, level, xpTotal };
  },
};
