import "server-only";

import { xpDedupeKey } from "@/config/xp";
import { db, type DbClient } from "@/db/client";
import type { WatchStatus } from "@/generated/prisma/enums";
import { toWatchDate } from "@/lib/dates";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { activityService } from "@/server/services/activity.service";
import { achievementsService, type UnlockedAchievement } from "@/server/services/achievements.service";
import { statsService, type StatDelta } from "@/server/services/stats.service";
import { streakService } from "@/server/services/streak.service";
import { xpService } from "@/server/services/xp.service";

/**
 * Watch tracking — the core loop.
 *
 * The model this file defends:
 *
 *   Show          canonical catalogue entry, shared by everyone
 *   UserShow      one user's relationship with it (status, rating, position)
 *   UserEpisode   one user's watched-episode facts — the source of truth
 *
 * Only `UserEpisode` rows are facts. Everything on `UserShow` (episodesWatched,
 * seasonsCompleted, currentSeason/Episode, status, minutesWatched) is a cache
 * derived from them, recomputed by `syncProgress` after every change. That is
 * why undo works correctly and why nothing drifts: there is exactly one
 * derivation, and it runs on every path.
 *
 * Everything here is server-side. The client sends "I watched episode X"; it
 * never sends counts, percentages, XP, completion state or timestamps, because
 * all of those are things it would be worth lying about.
 *
 * Specials (season 0) can be tracked but never count toward completion —
 * `totalEpisodes` excludes them, so counting them would put shows above 100%.
 */

/** The derived state of one user-show, recomputed from UserEpisode rows. */
export interface ProgressSnapshot {
  status: WatchStatus;
  episodesWatched: number;
  seasonsCompleted: number;
  currentSeasonNumber: number;
  currentEpisodeNumber: number;
  progress: number;
  /** True only on the transition into COMPLETED, so rewards fire once. */
  justCompletedShow: boolean;
  newlyCompletedSeasonIds: string[];
}

export interface TrackingOutcome {
  showId: string;
  status: WatchStatus;
  episodesWatched: number;
  totalEpisodes: number;
  currentSeasonNumber: number;
  currentEpisodeNumber: number;
  progress: number;
  xpAwarded: number;
  leveledUp: boolean;
  level: number;
  showCompleted: boolean;
  seasonsCompleted: number[];
  streak: { current: number; longest: number; extended: boolean } | null;
  achievements: UnlockedAchievement[];
}

/** Half-star ratings only, 0.5 through 5.0. */
export function isValidRating(rating: number): boolean {
  return Number.isFinite(rating) && rating >= 0.5 && rating <= 5 && Math.round(rating * 2) === rating * 2;
}

export const trackingService = {
  // -------------------------------------------------------------------------
  // Library membership
  // -------------------------------------------------------------------------

  /**
   * Adds a show to the library, or updates the entry if it is already there.
   * Setting the status to COMPLETED here marks every episode watched, because
   * "completed" must mean the same thing however it was reached.
   */
  async addToLibrary(
    userId: string,
    showId: string,
    input: {
      status?: WatchStatus;
      seasonNumber?: number;
      episodeNumber?: number;
      rating?: number | null;
    } = {},
  ): Promise<TrackingOutcome> {
    const status = input.status ?? "PLAN_TO_WATCH";

    if (input.rating !== null && input.rating !== undefined && !isValidRating(input.rating)) {
      throw errors.validation("Ratings go from 0.5 to 5 stars, in halves.");
    }

    return db.$transaction(
      async (tx) => {
        const show = await tx.show.findUnique({
          where: { id: showId },
          select: { id: true, title: true, type: true, slug: true, posterUrl: true, totalEpisodes: true },
        });
        if (!show) throw errors.notFound("That show is not in the catalogue.");

        const existing = await tx.userShow.findUnique({
          where: { userId_showId: { userId, showId } },
          select: { id: true, status: true },
        });

        const isNew = !existing;

        const userShow = await tx.userShow.upsert({
          where: { userId_showId: { userId, showId } },
          create: {
            userId,
            showId,
            status,
            rating: input.rating ?? null,
            startedAt: status === "PLAN_TO_WATCH" ? null : new Date(),
          },
          update: {
            status,
            ...(input.rating !== undefined ? { rating: input.rating } : {}),
          },
          select: { id: true, startedAt: true },
        });

        if (isNew) {
          await tx.show.update({
            where: { id: showId },
            data: { memberCount: { increment: 1 } },
          });
        }

        // "Completed" always means every episode is ticked.
        if (status === "COMPLETED") {
          await this.markAllEpisodes(tx, userId, showId);
        } else if (input.seasonNumber && input.episodeNumber) {
          await this.markEpisodesUpTo(tx, userId, showId, input.seasonNumber, input.episodeNumber);
        }

        const progress = await this.syncProgress(tx, userId, showId, { desiredStatus: status });
        const rewards = await this.applyRewards(tx, userId, showId, progress, { at: new Date() });

        await this.reconcileStatusCounters(tx, userId, existing?.status ?? null, progress.status, show.type, isNew);

        await activityService.record(tx, {
          userId,
          type: isNew ? "SHOW_ADDED" : "STATUS_CHANGED",
          showId,
          payload: {
            showTitle: show.title,
            showSlug: show.slug,
            posterUrl: show.posterUrl,
            showType: show.type,
            status: progress.status,
          },
        });

        return {
          showId,
          ...progress,
          ...rewards,
          totalEpisodes: show.totalEpisodes,
        };
      },
      { timeout: 30_000 },
    );
  },

  async removeFromLibrary(userId: string, showId: string): Promise<void> {
    await db.$transaction(async (tx) => {
      const existing = await tx.userShow.findUnique({
        where: { userId_showId: { userId, showId } },
        select: { status: true, show: { select: { type: true } } },
      });
      if (!existing) return;

      await tx.userEpisode.deleteMany({ where: { userId, showId } });
      await tx.userShow.delete({ where: { userId_showId: { userId, showId } } });
      await tx.activity.deleteMany({ where: { userId, showId } });
      await tx.show.update({
        where: { id: showId },
        data: { memberCount: { decrement: 1 } },
      });

      await this.reconcileStatusCounters(tx, userId, existing.status, null, existing.show.type, false);
      // Removing a show can empty days, so the streak is rebuilt from scratch.
      await streakService.recompute(tx, userId);
    });
  },

  async setStatus(userId: string, showId: string, status: WatchStatus): Promise<TrackingOutcome> {
    return this.addToLibrary(userId, showId, { status });
  },

  /**
   * Rates a show, maintaining the catalogue's running average as a
   * sum/count pair so it stays an O(1) update.
   */
  async rate(userId: string, showId: string, rating: number | null): Promise<void> {
    if (rating !== null && !isValidRating(rating)) {
      throw errors.validation("Ratings go from 0.5 to 5 stars, in halves.");
    }

    await db.$transaction(async (tx) => {
      const existing = await tx.userShow.findUnique({
        where: { userId_showId: { userId, showId } },
        select: { rating: true },
      });
      if (!existing) throw errors.notFound("Add the show to your library before rating it.");

      const previous = existing.rating;
      if (previous === rating) return;

      await tx.userShow.update({
        where: { userId_showId: { userId, showId } },
        data: { rating },
      });

      const sumDelta = (rating ?? 0) - (previous ?? 0);
      const countDelta = (rating === null ? 0 : 1) - (previous === null ? 0 : 1);

      await tx.show.update({
        where: { id: showId },
        data: {
          ratingSum: { increment: sumDelta },
          ratingCount: { increment: countDelta },
        },
      });

      if (rating !== null) {
        const show = await tx.show.findUnique({
          where: { id: showId },
          select: { title: true, slug: true, posterUrl: true, type: true },
        });
        await activityService.record(tx, {
          userId,
          type: "SHOW_RATED",
          showId,
          payload: {
            showTitle: show?.title,
            showSlug: show?.slug,
            posterUrl: show?.posterUrl,
            showType: show?.type,
            rating,
          },
        });
      }
    });
  },

  // -------------------------------------------------------------------------
  // Episode tracking
  // -------------------------------------------------------------------------

  /** Marks one episode watched. The single most-used write in the product. */
  async markEpisodeWatched(
    userId: string,
    episodeId: string,
    options: { at?: Date } = {},
  ): Promise<TrackingOutcome> {
    const at = options.at ?? new Date();

    return db.$transaction(
      async (tx) => {
        const episode = await tx.episode.findUnique({
          where: { id: episodeId },
          select: {
            id: true,
            showId: true,
            seasonId: true,
            seasonNumber: true,
            number: true,
            title: true,
            runtimeMinutes: true,
            show: {
              select: {
                id: true,
                title: true,
                slug: true,
                type: true,
                posterUrl: true,
                totalEpisodes: true,
                averageRuntimeMinutes: true,
              },
            },
          },
        });
        if (!episode) throw errors.notFound("That episode does not exist.");

        const previousUserShow = await this.ensureUserShow(tx, userId, episode.showId, episode.show.type);

        const inserted = await this.insertEpisodes(tx, userId, [
          {
            episodeId: episode.id,
            showId: episode.showId,
            seasonId: episode.seasonId,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.number,
          },
        ], at);

        const progress = await this.syncProgress(tx, userId, episode.showId);
        const rewards = await this.applyRewards(tx, userId, episode.showId, progress, {
          at,
          newEpisodes: inserted,
          minutes: inserted > 0 ? (episode.runtimeMinutes ?? episode.show.averageRuntimeMinutes) : 0,
        });

        await this.reconcileStatusCounters(
          tx,
          userId,
          previousUserShow.previousStatus,
          progress.status,
          episode.show.type,
          previousUserShow.created,
        );

        if (inserted > 0) {
          await activityService.record(tx, {
            userId,
            type: "EPISODE_WATCHED",
            showId: episode.showId,
            payload: {
              showTitle: episode.show.title,
              showSlug: episode.show.slug,
              showType: episode.show.type,
              posterUrl: episode.show.posterUrl,
              seasonNumber: episode.seasonNumber,
              episodeNumber: episode.number,
              episodeTitle: episode.title,
            },
          });
        }

        return {
          showId: episode.showId,
          ...progress,
          ...rewards,
          totalEpisodes: episode.show.totalEpisodes,
        };
      },
      { timeout: 30_000 },
    );
  },

  /**
   * Un-marks an episode. Progress caches roll back; the XP ledger does not.
   * See the note in config/xp.ts — that asymmetry is what makes toggling
   * pointless rather than profitable.
   */
  async unmarkEpisodeWatched(userId: string, episodeId: string): Promise<TrackingOutcome> {
    return db.$transaction(
      async (tx) => {
        const existing = await tx.userEpisode.findUnique({
          where: { userId_episodeId: { userId, episodeId } },
          select: { showId: true, watchedOn: true },
        });
        if (!existing) throw errors.notFound("You had not marked that episode anyway.");

        const episode = await tx.episode.findUnique({
          where: { id: episodeId },
          select: {
            runtimeMinutes: true,
            show: {
              select: { id: true, type: true, totalEpisodes: true, averageRuntimeMinutes: true },
            },
          },
        });
        if (!episode) throw errors.notFound("That episode does not exist.");

        const previous = await tx.userShow.findUnique({
          where: { userId_showId: { userId, showId: existing.showId } },
          select: { status: true },
        });

        await tx.userEpisode.delete({ where: { userId_episodeId: { userId, episodeId } } });

        // Roll the day's rollup back so "episodes in one day" stays honest.
        await tx.dailyWatchLog.updateMany({
          where: { userId, date: existing.watchedOn, episodesWatched: { gt: 0 } },
          data: {
            episodesWatched: { decrement: 1 },
            minutesWatched: {
              decrement: episode.runtimeMinutes ?? episode.show.averageRuntimeMinutes,
            },
          },
        });

        const progress = await this.syncProgress(tx, userId, existing.showId);

        await this.reconcileStatusCounters(
          tx,
          userId,
          previous?.status ?? null,
          progress.status,
          episode.show.type,
          false,
        );

        await statsService.applyDelta(tx, userId, {
          episodesWatched: -1,
          minutesWatched: -(episode.runtimeMinutes ?? episode.show.averageRuntimeMinutes),
        });

        return {
          showId: existing.showId,
          ...progress,
          totalEpisodes: episode.show.totalEpisodes,
          xpAwarded: 0,
          leveledUp: false,
          level: (await tx.userStats.findUnique({ where: { userId }, select: { level: true } }))?.level ?? 1,
          showCompleted: progress.status === "COMPLETED",
          seasonsCompleted: [],
          streak: null,
          achievements: [],
        };
      },
      { timeout: 30_000 },
    );
  },

  /** Marks every episode of a season watched in one go. */
  async markSeasonWatched(userId: string, seasonId: string): Promise<TrackingOutcome> {
    return db.$transaction(
      async (tx) => {
        const season = await tx.season.findUnique({
          where: { id: seasonId },
          select: {
            id: true,
            number: true,
            showId: true,
            show: {
              select: {
                id: true,
                title: true,
                slug: true,
                type: true,
                posterUrl: true,
                totalEpisodes: true,
                averageRuntimeMinutes: true,
              },
            },
            episodes: { select: { id: true, number: true, runtimeMinutes: true } },
          },
        });
        if (!season) throw errors.notFound("That season does not exist.");

        const previousUserShow = await this.ensureUserShow(tx, userId, season.showId, season.show.type);
        const at = new Date();

        const inserted = await this.insertEpisodes(
          tx,
          userId,
          season.episodes.map((episode) => ({
            episodeId: episode.id,
            showId: season.showId,
            seasonId: season.id,
            seasonNumber: season.number,
            episodeNumber: episode.number,
          })),
          at,
        );

        const minutes = season.episodes.reduce(
          (sum, episode) => sum + (episode.runtimeMinutes ?? season.show.averageRuntimeMinutes),
          0,
        );

        const progress = await this.syncProgress(tx, userId, season.showId);
        const rewards = await this.applyRewards(tx, userId, season.showId, progress, {
          at,
          newEpisodes: inserted,
          // Minutes are apportioned to the episodes actually inserted, so
          // re-marking an already-complete season adds nothing.
          minutes: inserted > 0 ? Math.round((minutes / season.episodes.length) * inserted) : 0,
        });

        await this.reconcileStatusCounters(
          tx,
          userId,
          previousUserShow.previousStatus,
          progress.status,
          season.show.type,
          previousUserShow.created,
        );

        return {
          showId: season.showId,
          ...progress,
          ...rewards,
          totalEpisodes: season.show.totalEpisodes,
        };
      },
      { timeout: 60_000 },
    );
  },

  /**
   * Marks everything up to and including a position — the "I forgot to track
   * the last 40 episodes" button.
   */
  async markWatchedUpTo(
    userId: string,
    showId: string,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<TrackingOutcome> {
    return db.$transaction(
      async (tx) => {
        const show = await tx.show.findUnique({
          where: { id: showId },
          select: { id: true, type: true, totalEpisodes: true, averageRuntimeMinutes: true },
        });
        if (!show) throw errors.notFound("That show is not in the catalogue.");

        const previousUserShow = await this.ensureUserShow(tx, userId, showId, show.type);
        const at = new Date();

        const { inserted, minutes } = await this.markEpisodesUpTo(
          tx,
          userId,
          showId,
          seasonNumber,
          episodeNumber,
          at,
        );

        const progress = await this.syncProgress(tx, userId, showId);
        const rewards = await this.applyRewards(tx, userId, showId, progress, {
          at,
          newEpisodes: inserted,
          minutes,
        });

        await this.reconcileStatusCounters(
          tx,
          userId,
          previousUserShow.previousStatus,
          progress.status,
          show.type,
          previousUserShow.created,
        );

        return { showId, ...progress, ...rewards, totalEpisodes: show.totalEpisodes };
      },
      { timeout: 60_000 },
    );
  },

  /**
   * "Continue watching": marks the next unwatched episode. Returns null when
   * there is nothing left, so the caller can show the completion state.
   */
  async continueWatching(userId: string, showId: string): Promise<TrackingOutcome | null> {
    const next = await this.getNextEpisode(userId, showId);
    if (!next) return null;
    return this.markEpisodeWatched(userId, next.id);
  },

  /**
   * The lowest-numbered unwatched regular episode. Uses a NOT EXISTS-style
   * `none` filter so the database does the work — no loading of watch history.
   */
  async getNextEpisode(userId: string, showId: string, client: DbClient = db) {
    return client.episode.findFirst({
      where: {
        showId,
        seasonNumber: { gt: 0 },
        userEpisodes: { none: { userId } },
      },
      orderBy: [{ seasonNumber: "asc" }, { number: "asc" }],
      select: {
        id: true,
        number: true,
        seasonNumber: true,
        title: true,
        runtimeMinutes: true,
        stillUrl: true,
      },
    });
  },

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Creates the UserShow row if the user is tracking this show implicitly. */
  async ensureUserShow(
    tx: DbClient,
    userId: string,
    showId: string,
    _showType: string,
  ): Promise<{ created: boolean; previousStatus: WatchStatus | null }> {
    const existing = await tx.userShow.findUnique({
      where: { userId_showId: { userId, showId } },
      select: { status: true },
    });

    if (existing) return { created: false, previousStatus: existing.status };

    await tx.userShow.create({
      data: { userId, showId, status: "WATCHING", startedAt: new Date() },
    });
    await tx.show.update({ where: { id: showId }, data: { memberCount: { increment: 1 } } });

    return { created: true, previousStatus: null };
  },

  /**
   * Bulk-inserts watched-episode rows, skipping ones already there, and
   * returns how many were genuinely new. `skipDuplicates` makes this safe to
   * call with overlapping sets — which is exactly what "mark season" and
   * "mark up to" do.
   */
  async insertEpisodes(
    tx: DbClient,
    userId: string,
    episodes: {
      episodeId: string;
      showId: string;
      seasonId: string;
      seasonNumber: number;
      episodeNumber: number;
    }[],
    at: Date,
  ): Promise<number> {
    if (episodes.length === 0) return 0;

    const result = await tx.userEpisode.createMany({
      data: episodes.map((episode) => ({
        userId,
        episodeId: episode.episodeId,
        showId: episode.showId,
        seasonId: episode.seasonId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        watchedAt: at,
        watchedOn: toWatchDate(at),
      })),
      skipDuplicates: true,
    });

    return result.count;
  },

  /** Marks every regular episode at or before a position. */
  async markEpisodesUpTo(
    tx: DbClient,
    userId: string,
    showId: string,
    seasonNumber: number,
    episodeNumber: number,
    at: Date = new Date(),
  ): Promise<{ inserted: number; minutes: number }> {
    const show = await tx.show.findUnique({
      where: { id: showId },
      select: { averageRuntimeMinutes: true },
    });

    const episodes = await tx.episode.findMany({
      where: {
        showId,
        seasonNumber: { gt: 0 },
        OR: [
          { seasonNumber: { lt: seasonNumber } },
          { seasonNumber, number: { lte: episodeNumber } },
        ],
        userEpisodes: { none: { userId } },
      },
      select: { id: true, seasonId: true, seasonNumber: true, number: true, runtimeMinutes: true },
    });

    const inserted = await this.insertEpisodes(
      tx,
      userId,
      episodes.map((episode) => ({
        episodeId: episode.id,
        showId,
        seasonId: episode.seasonId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.number,
      })),
      at,
    );

    const minutes = episodes.reduce(
      (sum, episode) => sum + (episode.runtimeMinutes ?? show?.averageRuntimeMinutes ?? 24),
      0,
    );

    return { inserted, minutes };
  },

  /** Marks every regular episode of a show. Used by status = COMPLETED. */
  async markAllEpisodes(tx: DbClient, userId: string, showId: string): Promise<number> {
    const episodes = await tx.episode.findMany({
      where: { showId, seasonNumber: { gt: 0 }, userEpisodes: { none: { userId } } },
      select: { id: true, seasonId: true, seasonNumber: true, number: true },
    });

    return this.insertEpisodes(
      tx,
      userId,
      episodes.map((episode) => ({
        episodeId: episode.id,
        showId,
        seasonId: episode.seasonId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.number,
      })),
      new Date(),
    );
  },

  /**
   * Re-derives every cached field on UserShow from the UserEpisode rows.
   *
   * This is the one place progress is computed. Automatic status changes live
   * here too: finishing the last episode sets COMPLETED and stamps
   * `completedAt`; un-watching one drops a completed show back to WATCHING.
   */
  async syncProgress(
    tx: DbClient,
    userId: string,
    showId: string,
    options: { desiredStatus?: WatchStatus } = {},
  ): Promise<ProgressSnapshot> {
    const [show, userShow] = await Promise.all([
      tx.show.findUniqueOrThrow({
        where: { id: showId },
        select: { totalEpisodes: true, averageRuntimeMinutes: true },
      }),
      tx.userShow.findUniqueOrThrow({
        where: { userId_showId: { userId, showId } },
        select: {
          status: true,
          startedAt: true,
          completedAt: true,
          seasonsCompleted: true,
        },
      }),
    ]);

    // Regular episodes only: specials are excluded from totalEpisodes.
    const episodesWatched = await tx.userEpisode.count({
      where: { userId, showId, seasonNumber: { gt: 0 } },
    });

    const position = await tx.userEpisode.findFirst({
      where: { userId, showId, seasonNumber: { gt: 0 } },
      orderBy: [{ seasonNumber: "desc" }, { episodeNumber: "desc" }],
      select: { seasonNumber: true, episodeNumber: true },
    });

    // Which seasons are now complete: one grouped count over this user's rows
    // for this show, compared against each season's episode count.
    const [seasons, watchedPerSeason] = await Promise.all([
      tx.season.findMany({
        where: { showId, number: { gt: 0 } },
        select: { id: true, episodeCount: true },
      }),
      tx.userEpisode.groupBy({
        by: ["seasonId"],
        where: { userId, showId, seasonNumber: { gt: 0 } },
        _count: { _all: true },
      }),
    ]);

    const watchedBySeason = new Map(
      watchedPerSeason.map((row) => [row.seasonId, row._count._all]),
    );
    const completedSeasonIds = seasons
      .filter(
        (season) => season.episodeCount > 0 && (watchedBySeason.get(season.id) ?? 0) >= season.episodeCount,
      )
      .map((season) => season.id);

    const minutesWatched = await this.computeMinutesWatched(tx, userId, showId, show.averageRuntimeMinutes);

    const isComplete = show.totalEpisodes > 0 && episodesWatched >= show.totalEpisodes;
    const wasComplete = userShow.status === "COMPLETED";

    // Status resolution, in priority order:
    //  - an explicit request wins, unless the facts contradict it
    //  - finishing the last episode completes the show
    //  - un-watching from a completed show drops back to WATCHING
    //  - otherwise: keep terminal states (DROPPED/ON_HOLD), else WATCHING
    let status: WatchStatus;
    if (options.desiredStatus && options.desiredStatus !== "COMPLETED") {
      status = options.desiredStatus;
    } else if (isComplete) {
      status = userShow.status === "REWATCHING" ? "REWATCHING" : "COMPLETED";
    } else if (wasComplete) {
      status = "WATCHING";
    } else if (userShow.status === "DROPPED" || userShow.status === "ON_HOLD") {
      status = userShow.status;
    } else if (episodesWatched > 0) {
      status = userShow.status === "REWATCHING" ? "REWATCHING" : "WATCHING";
    } else {
      status = userShow.status === "WATCHING" ? "PLAN_TO_WATCH" : userShow.status;
    }

    const justCompletedShow = status === "COMPLETED" && !wasComplete;

    await tx.userShow.update({
      where: { userId_showId: { userId, showId } },
      data: {
        status,
        episodesWatched,
        minutesWatched,
        seasonsCompleted: completedSeasonIds.length,
        currentSeasonNumber: position?.seasonNumber ?? 0,
        currentEpisodeNumber: position?.episodeNumber ?? 0,
        lastWatchedAt: episodesWatched > 0 ? new Date() : null,
        startedAt: userShow.startedAt ?? (episodesWatched > 0 ? new Date() : null),
        completedAt: status === "COMPLETED" ? (userShow.completedAt ?? new Date()) : null,
      },
    });

    return {
      status,
      episodesWatched,
      seasonsCompleted: completedSeasonIds.length,
      currentSeasonNumber: position?.seasonNumber ?? 0,
      currentEpisodeNumber: position?.episodeNumber ?? 0,
      progress: show.totalEpisodes > 0 ? Math.min(1, episodesWatched / show.totalEpisodes) : 0,
      justCompletedShow,
      newlyCompletedSeasonIds: completedSeasonIds,
    };
  },

  /**
   * Exact watch time for one show: each episode's own runtime where the
   * provider gave us one, the show average otherwise. Scoped to a single show,
   * so even One Piece is a bounded read.
   */
  async computeMinutesWatched(
    tx: DbClient,
    userId: string,
    showId: string,
    fallbackRuntime: number,
  ): Promise<number> {
    const rows = await tx.userEpisode.findMany({
      where: { userId, showId },
      select: { episode: { select: { runtimeMinutes: true } } },
    });

    return rows.reduce((sum, row) => sum + (row.episode.runtimeMinutes ?? fallbackRuntime), 0);
  },

  /**
   * Pays out everything a change earned: episode/season/show XP, the daily
   * streak, achievements and the level-up activity. Every award is deduped by
   * a stable key, so calling this after a no-op change costs nothing.
   */
  async applyRewards(
    tx: DbClient,
    userId: string,
    showId: string,
    progress: ProgressSnapshot,
    options: { at: Date; newEpisodes?: number; minutes?: number },
  ): Promise<{
    xpAwarded: number;
    leveledUp: boolean;
    level: number;
    showCompleted: boolean;
    seasonsCompleted: number[];
    streak: { current: number; longest: number; extended: boolean } | null;
    achievements: UnlockedAchievement[];
  }> {
    const newEpisodes = options.newEpisodes ?? 0;

    const awards: { reason: Parameters<typeof xpService.award>[2]; dedupeKey: string; amount?: number }[] = [];

    // Episode XP is per *episode id*, so it can never be re-earned. Awarding a
    // flat multiple would be farmable via unwatch/rewatch.
    if (newEpisodes > 0) {
      const recent = await tx.userEpisode.findMany({
        where: { userId, showId, watchedAt: { gte: options.at } },
        select: { episodeId: true },
      });
      for (const row of recent) {
        awards.push({ reason: "EPISODE_WATCHED", dedupeKey: xpDedupeKey.episode(row.episodeId) });
      }
    }

    for (const seasonId of progress.newlyCompletedSeasonIds) {
      awards.push({ reason: "SEASON_COMPLETED", dedupeKey: xpDedupeKey.season(seasonId) });
    }

    if (progress.status === "COMPLETED") {
      awards.push({ reason: "SHOW_COMPLETED", dedupeKey: xpDedupeKey.show(showId) });
    }

    const xpResult = await xpService.awardMany(tx, userId, awards);

    let streak: { current: number; longest: number; extended: boolean } | null = null;
    if (newEpisodes > 0) {
      const result = await streakService.recordActivity(tx, userId, {
        at: options.at,
        episodes: newEpisodes,
        minutes: options.minutes ?? 0,
      });
      streak = { current: result.current, longest: result.longest, extended: result.extended };

      await statsService.applyDelta(tx, userId, {
        episodesWatched: newEpisodes,
        minutesWatched: options.minutes ?? 0,
        seasonsCompleted: progress.newlyCompletedSeasonIds.length,
      });
    }

    const achievements = await achievementsService.evaluate(tx, userId);

    const activities: Parameters<typeof activityService.recordMany>[2] = [];

    if (progress.justCompletedShow) {
      const show = await tx.show.findUnique({
        where: { id: showId },
        select: { title: true, slug: true, posterUrl: true, type: true },
      });
      activities.push({
        type: "SHOW_COMPLETED",
        showId,
        payload: {
          showTitle: show?.title,
          showSlug: show?.slug,
          posterUrl: show?.posterUrl,
          showType: show?.type,
          episodes: progress.episodesWatched,
        },
      });
    }

    if (xpResult.leveledUp) {
      activities.push({ type: "LEVEL_UP", payload: { level: xpResult.level } });
    }

    for (const achievement of achievements) {
      activities.push({
        type: "ACHIEVEMENT_UNLOCKED",
        achievementId: achievement.id,
        payload: { name: achievement.name, icon: achievement.icon, code: achievement.code },
      });
    }

    await activityService.recordMany(tx, userId, activities);

    if (progress.justCompletedShow) {
      logger.info("Show completed", { userId, showId, episodes: progress.episodesWatched });
    }

    return {
      xpAwarded: xpResult.totalAwarded,
      leveledUp: xpResult.leveledUp,
      level: xpResult.level,
      showCompleted: progress.justCompletedShow,
      seasonsCompleted: [],
      streak,
      achievements,
    };
  },

  /**
   * Keeps the per-status counters on `user_stats` in step with a status move.
   * Called with the before and after status; a null means "not in the library".
   */
  async reconcileStatusCounters(
    tx: DbClient,
    userId: string,
    from: WatchStatus | null,
    to: WatchStatus | null,
    showType: string,
    _isNew: boolean,
  ): Promise<void> {
    if (from === to) return;

    const delta: StatDelta = {};
    const bump = (status: WatchStatus | null, amount: 1 | -1) => {
      switch (status) {
        case "WATCHING":
          delta.watching = (delta.watching ?? 0) + amount;
          break;
        case "PLAN_TO_WATCH":
          delta.planToWatch = (delta.planToWatch ?? 0) + amount;
          break;
        case "ON_HOLD":
          delta.onHold = (delta.onHold ?? 0) + amount;
          break;
        case "DROPPED":
          delta.dropped = (delta.dropped ?? 0) + amount;
          break;
        case "REWATCHING":
          delta.rewatching = (delta.rewatching ?? 0) + amount;
          break;
        case "COMPLETED":
          delta.showsCompleted = (delta.showsCompleted ?? 0) + amount;
          if (showType === "ANIME") delta.animeCompleted = (delta.animeCompleted ?? 0) + amount;
          else delta.tvCompleted = (delta.tvCompleted ?? 0) + amount;
          break;
        default:
          break;
      }
    };

    bump(from, -1);
    bump(to, 1);

    await statsService.applyDelta(tx, userId, delta);
  },
};
