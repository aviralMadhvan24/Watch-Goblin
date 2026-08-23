import "server-only";

import { xpDedupeKey } from "@/config/xp";
import type { DbClient } from "@/db/client";
import { daysBetween, toIsoDate, toWatchDate } from "@/lib/dates";
import { xpService } from "@/server/services/xp.service";

/**
 * Watch streaks.
 *
 * A streak is a property of the set of *days* on which the user watched
 * something, which is why `daily_watch_logs` exists: the streak never has to
 * look at episodes, and "most episodes in one day" is a single indexed read
 * rather than a group-by over a user's entire history.
 *
 * Days are UTC calendar days — see the note in lib/dates.ts.
 */

export interface StreakResult {
  current: number;
  longest: number;
  /** True when this call moved the streak forward (first watch of the day). */
  extended: boolean;
  /** True when a gap reset the streak to 1. */
  reset: boolean;
}

/** Milestones worth announcing in the feed. */
const STREAK_MILESTONES = new Set([3, 7, 14, 30, 50, 100, 200, 365]);

export const streakService = {
  /**
   * Records watch activity for a day and advances the streak.
   * Idempotent within a day: the second episode you watch today does not
   * extend the streak again, and does not pay the daily XP again.
   */
  async recordActivity(
    tx: DbClient,
    userId: string,
    options: { at?: Date; episodes?: number; minutes?: number } = {},
  ): Promise<StreakResult & { milestone: number | null; xpAwarded: number }> {
    const at = options.at ?? new Date();
    const today = toWatchDate(at);
    const episodes = options.episodes ?? 1;
    const minutes = options.minutes ?? 0;

    await tx.dailyWatchLog.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, episodesWatched: episodes, minutesWatched: minutes },
      update: {
        episodesWatched: { increment: episodes },
        minutesWatched: { increment: minutes },
      },
    });

    const streak = await tx.watchStreak.upsert({
      where: { userId },
      create: { userId, current: 0, longest: 0 },
      update: {},
    });

    // Already counted today: nothing to advance.
    if (streak.lastWatchDate && daysBetween(streak.lastWatchDate, today) === 0) {
      return {
        current: streak.current,
        longest: streak.longest,
        extended: false,
        reset: false,
        milestone: null,
        xpAwarded: 0,
      };
    }

    const gap = streak.lastWatchDate ? daysBetween(streak.lastWatchDate, today) : null;
    // gap === 1 means "yesterday", which continues the run. Anything larger
    // (or a first-ever watch) starts a new one.
    const continues = gap === 1;

    const current = continues ? streak.current + 1 : 1;
    const longest = Math.max(streak.longest, current);

    await tx.watchStreak.update({
      where: { userId },
      data: {
        current,
        longest,
        lastWatchDate: today,
        startedOn: continues ? (streak.startedOn ?? today) : today,
      },
    });

    await tx.userStats.update({
      where: { userId },
      data: { currentStreak: current, longestStreak: longest },
    });

    // One daily-streak award per calendar day, enforced by the dedupe key.
    const award = await xpService.award(
      tx,
      userId,
      "DAILY_STREAK",
      xpDedupeKey.dailyStreak(toIsoDate(today)),
      { payload: { streak: current } },
    );

    return {
      current,
      longest,
      extended: true,
      reset: !continues && streak.current > 0,
      milestone: STREAK_MILESTONES.has(current) ? current : null,
      xpAwarded: award.amount,
    };
  },

  /**
   * Recomputes the streak from `daily_watch_logs`. Used after an un-watch
   * empties a day, and by the stats repair path.
   */
  async recompute(tx: DbClient, userId: string, now: Date = new Date()): Promise<StreakResult> {
    const days = await tx.dailyWatchLog.findMany({
      where: { userId, episodesWatched: { gt: 0 } },
      select: { date: true },
      orderBy: { date: "asc" },
    });

    let longest = 0;
    let run = 0;
    let previous: Date | null = null;

    for (const day of days) {
      run = previous && daysBetween(previous, day.date) === 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
      previous = day.date;
    }

    // The trailing run only counts as "current" if it reaches today or
    // yesterday — otherwise it has already been broken.
    const today = toWatchDate(now);
    const gapToNow = previous ? daysBetween(previous, today) : null;
    const current = gapToNow !== null && gapToNow <= 1 ? run : 0;

    await tx.watchStreak.upsert({
      where: { userId },
      create: { userId, current, longest, lastWatchDate: previous ?? null },
      update: { current, longest, lastWatchDate: previous ?? null },
    });

    await tx.userStats.update({
      where: { userId },
      data: { currentStreak: current, longestStreak: longest },
    });

    return { current, longest, extended: false, reset: false };
  },
};
