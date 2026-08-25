import "server-only";

import { db } from "@/db/client";
import type { Prisma } from "@/generated/prisma/client";
import type { ShowType, WatchStatus } from "@/generated/prisma/enums";

/**
 * The signed-in user's own library and dashboard reads.
 *
 * Progress percentages are computed here rather than stored, because
 * `episodesWatched` and `totalEpisodes` are both already on hand and a stored
 * percentage is one more cache to drift.
 */

export type LibrarySort = "recent" | "progress" | "rating" | "title" | "added";

const LIBRARY_ORDER: Record<LibrarySort, Prisma.UserShowOrderByWithRelationInput[]> = {
  recent: [{ lastWatchedAt: "desc" }, { updatedAt: "desc" }],
  progress: [{ episodesWatched: "desc" }],
  rating: [{ rating: "desc" }],
  added: [{ createdAt: "desc" }],
  title: [{ show: { title: "asc" } }],
};

const entrySelect = {
  id: true,
  status: true,
  rating: true,
  episodesWatched: true,
  seasonsCompleted: true,
  minutesWatched: true,
  currentSeasonNumber: true,
  currentEpisodeNumber: true,
  lastWatchedAt: true,
  createdAt: true,
  show: {
    select: {
      id: true,
      slug: true,
      title: true,
      type: true,
      posterUrl: true,
      totalEpisodes: true,
      airingStatus: true,
    },
  },
} as const;

export interface LibraryEntry {
  id: string;
  status: WatchStatus;
  rating: number | null;
  episodesWatched: number;
  seasonsCompleted: number;
  minutesWatched: number;
  currentSeasonNumber: number;
  currentEpisodeNumber: number;
  lastWatchedAt: Date | null;
  progress: number;
  show: {
    id: string;
    slug: string;
    title: string;
    type: ShowType;
    posterUrl: string | null;
    totalEpisodes: number;
  };
}

function toEntry(row: {
  id: string;
  status: WatchStatus;
  rating: number | null;
  episodesWatched: number;
  seasonsCompleted: number;
  minutesWatched: number;
  currentSeasonNumber: number;
  currentEpisodeNumber: number;
  lastWatchedAt: Date | null;
  show: {
    id: string;
    slug: string;
    title: string;
    type: ShowType;
    posterUrl: string | null;
    totalEpisodes: number;
  };
}): LibraryEntry {
  return {
    id: row.id,
    status: row.status,
    rating: row.rating,
    episodesWatched: row.episodesWatched,
    seasonsCompleted: row.seasonsCompleted,
    minutesWatched: row.minutesWatched,
    currentSeasonNumber: row.currentSeasonNumber,
    currentEpisodeNumber: row.currentEpisodeNumber,
    lastWatchedAt: row.lastWatchedAt,
    progress:
      row.show.totalEpisodes > 0
        ? Math.min(100, Math.round((row.episodesWatched / row.show.totalEpisodes) * 100))
        : 0,
    show: row.show,
  };
}

export async function getLibrary(
  userId: string,
  options: { status?: WatchStatus; type?: ShowType; sort?: LibrarySort; q?: string } = {},
) {
  const rows = await db.userShow.findMany({
    where: {
      userId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.type ? { show: { type: options.type } } : {}),
      ...(options.q
        ? { show: { title: { contains: options.q, mode: "insensitive" as const } } }
        : {}),
    },
    orderBy: LIBRARY_ORDER[options.sort ?? "recent"],
    select: entrySelect,
  });

  return rows.map(toEntry);
}

/** Counts per status, used for the library tab badges. */
export async function getLibraryCounts(userId: string): Promise<Record<WatchStatus, number>> {
  const grouped = await db.userShow.groupBy({
    by: ["status"],
    where: { userId },
    _count: { status: true },
  });

  const counts = {
    PLAN_TO_WATCH: 0,
    WATCHING: 0,
    COMPLETED: 0,
    ON_HOLD: 0,
    DROPPED: 0,
    REWATCHING: 0,
  } satisfies Record<WatchStatus, number>;

  for (const row of grouped) counts[row.status] = row._count.status;
  return counts;
}

/**
 * "Continue watching" — in-progress shows with the next unwatched episode
 * attached. The next episode is resolved per show with a `none` filter so the
 * database does the work rather than loading watch history into memory.
 */
export async function getContinueWatching(userId: string, limit = 8) {
  const rows = await db.userShow.findMany({
    where: { userId, status: { in: ["WATCHING", "REWATCHING"] } },
    orderBy: [{ lastWatchedAt: "desc" }, { updatedAt: "desc" }],
    take: limit,
    select: entrySelect,
  });

  const withNext = await Promise.all(
    rows.map(async (row) => {
      const next = await db.episode.findFirst({
        where: { showId: row.show.id, seasonNumber: { gt: 0 }, userEpisodes: { none: { userId } } },
        orderBy: [{ seasonNumber: "asc" }, { number: "asc" }],
        select: { id: true, number: true, seasonNumber: true, title: true, runtimeMinutes: true },
      });
      return { ...toEntry(row), nextEpisode: next };
    }),
  );

  // A show with nothing left to watch is not "continue watching" — it is a
  // completion the tracking service has not been asked to finalise yet.
  return withNext.filter((entry) => entry.nextEpisode !== null);
}

export type ContinueWatchingEntry = Awaited<ReturnType<typeof getContinueWatching>>[number];

export async function getUserStats(userId: string) {
  return db.userStats.findUnique({
    where: { userId },
    select: {
      showsCompleted: true,
      animeCompleted: true,
      tvCompleted: true,
      seasonsCompleted: true,
      episodesWatched: true,
      minutesWatched: true,
      watching: true,
      planToWatch: true,
      onHold: true,
      dropped: true,
      rewatching: true,
      reviewsPosted: true,
      reviewLikesReceived: true,
      followersCount: true,
      followingCount: true,
      xpTotal: true,
      level: true,
      currentStreak: true,
      longestStreak: true,
      rank: {
        select: { name: true, icon: true, description: true, accentColor: true, minLevel: true },
      },
    },
  });
}

export type UserStatsData = NonNullable<Awaited<ReturnType<typeof getUserStats>>>;

export async function getStreak(userId: string) {
  return db.watchStreak.findUnique({
    where: { userId },
    select: { current: true, longest: true, lastWatchDate: true, startedOn: true },
  });
}

/** Daily watch totals for the activity heat strip. */
export async function getDailyWatchLogs(userId: string, days = 30) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  return db.dailyWatchLog.findMany({
    where: { userId, date: { gte: since } },
    orderBy: { date: "asc" },
    select: { date: true, episodesWatched: true, minutesWatched: true },
  });
}
