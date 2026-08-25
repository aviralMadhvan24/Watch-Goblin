import "server-only";

import { db } from "@/db/client";
import type { ActivityType, Visibility } from "@/generated/prisma/enums";

/**
 * Profiles, the activity feed, follows and leaderboards.
 *
 * Visibility is enforced here, in the read path, rather than in the components
 * that happen to render it — a page that forgets to check is then a page that
 * simply has no data, not a privacy leak.
 */

const actorSelect = {
  username: true,
  profile: { select: { displayName: true, avatarUrl: true, accentColor: true } },
} as const;

function toActor(row: {
  username: string;
  profile: { displayName: string; avatarUrl: string | null; accentColor: string } | null;
}) {
  return {
    username: row.username,
    displayName: row.profile?.displayName ?? row.username,
    avatarUrl: row.profile?.avatarUrl ?? null,
    accentColor: row.profile?.accentColor ?? null,
  };
}

export type Actor = ReturnType<typeof toActor>;

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/**
 * Whether `viewerId` may see content at the given visibility level.
 * The owner always passes; `FOLLOWERS` costs one extra query, and only when
 * that is actually the setting.
 */
export async function canView(
  visibility: Visibility,
  ownerId: string,
  viewerId?: string | null,
): Promise<boolean> {
  if (viewerId === ownerId) return true;
  if (visibility === "PUBLIC") return true;
  if (visibility === "PRIVATE" || !viewerId) return false;

  const follows = await db.follow.findUnique({
    where: { followerId_followingId: { followerId: viewerId, followingId: ownerId } },
    select: { followerId: true },
  });
  return follows !== null;
}

export async function getProfile(username: string, viewerId?: string | null) {
  const user = await db.user.findUnique({
    where: { username: username.toLowerCase() },
    select: {
      id: true,
      username: true,
      createdAt: true,
      isBanned: true,
      profile: {
        select: {
          displayName: true,
          bio: true,
          avatarUrl: true,
          bannerUrl: true,
          accentColor: true,
          visibility: true,
          activityVisibility: true,
        },
      },
      stats: {
        select: {
          showsCompleted: true,
          animeCompleted: true,
          tvCompleted: true,
          seasonsCompleted: true,
          episodesWatched: true,
          minutesWatched: true,
          watching: true,
          planToWatch: true,
          reviewsPosted: true,
          followersCount: true,
          followingCount: true,
          xpTotal: true,
          level: true,
          currentStreak: true,
          longestStreak: true,
          rank: { select: { name: true, icon: true, accentColor: true, description: true } },
        },
      },
      favoriteShows: {
        orderBy: { slot: "asc" },
        select: {
          slot: true,
          show: { select: { slug: true, title: true, posterUrl: true, type: true } },
        },
      },
    },
  });

  if (!user || user.isBanned) return null;

  const isSelf = viewerId === user.id;

  // A blocked viewer is told the profile does not exist rather than that they
  // are blocked — the latter is itself information the blocker did not share.
  if (viewerId && !isSelf) {
    const blocked = await db.block.findFirst({
      where: {
        OR: [
          { blockerId: user.id, blockedId: viewerId },
          { blockerId: viewerId, blockedId: user.id },
        ],
      },
      select: { blockerId: true },
    });
    if (blocked) return null;
  }

  const visibility = user.profile?.visibility ?? "PUBLIC";
  const visible = await canView(visibility, user.id, viewerId);
  const activityVisible =
    visible && (await canView(user.profile?.activityVisibility ?? "PUBLIC", user.id, viewerId));

  const isFollowing =
    viewerId && !isSelf
      ? (await db.follow.findUnique({
          where: { followerId_followingId: { followerId: viewerId, followingId: user.id } },
          select: { followerId: true },
        })) !== null
      : false;

  return {
    id: user.id,
    username: user.username,
    displayName: user.profile?.displayName ?? user.username,
    bio: user.profile?.bio ?? null,
    avatarUrl: user.profile?.avatarUrl ?? null,
    bannerUrl: user.profile?.bannerUrl ?? null,
    accentColor: user.profile?.accentColor ?? "#8b5cf6",
    joinedAt: user.createdAt,
    stats: user.stats,
    favoriteShows: user.favoriteShows.map((f) => ({ slot: f.slot, ...f.show })),
    isSelf,
    isFollowing,
    /** False when the profile is private to this viewer: render the locked state. */
    visible,
    activityVisible,
  };
}

export type ProfileData = NonNullable<Awaited<ReturnType<typeof getProfile>>>;

/** A profile's recently watched episodes. Only called once visibility passed. */
export async function getRecentlyWatched(userId: string, limit = 12) {
  return db.userEpisode.findMany({
    where: { userId },
    orderBy: { watchedAt: "desc" },
    take: limit,
    select: {
      episodeId: true,
      watchedAt: true,
      seasonNumber: true,
      episodeNumber: true,
      show: { select: { slug: true, title: true, posterUrl: true } },
      episode: { select: { title: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

const activitySelect = {
  id: true,
  type: true,
  payload: true,
  createdAt: true,
  user: { select: actorSelect },
  show: { select: { slug: true, title: true, posterUrl: true } },
  targetUser: { select: { username: true } },
  achievement: { select: { name: true, icon: true } },
  review: { select: { id: true, rating: true } },
} as const;

export interface FeedItem {
  id: string;
  type: ActivityType;
  payload: Record<string, unknown>;
  createdAt: Date;
  actor: Actor;
  show: { slug: string; title: string; posterUrl: string | null } | null;
  targetUsername: string | null;
  achievement: { name: string; icon: string } | null;
  review: { id: string; rating: number } | null;
}

function toFeedItem(row: {
  id: string;
  type: ActivityType;
  payload: unknown;
  createdAt: Date;
  user: { username: string; profile: { displayName: string; avatarUrl: string | null; accentColor: string } | null };
  show: { slug: string; title: string; posterUrl: string | null } | null;
  targetUser: { username: string } | null;
  achievement: { name: string; icon: string } | null;
  review: { id: string; rating: number } | null;
}): FeedItem {
  return {
    id: row.id,
    type: row.type,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    actor: toActor(row.user),
    show: row.show,
    targetUsername: row.targetUser?.username ?? null,
    achievement: row.achievement,
    review: row.review,
  };
}

/** The home feed: everyone the viewer follows, plus the viewer. */
export async function getFollowingFeed(viewerId: string, limit = 40) {
  const following = await db.follow.findMany({
    where: { followerId: viewerId },
    select: { followingId: true },
  });

  const authorIds = [...following.map((f) => f.followingId), viewerId];

  const rows = await db.activity.findMany({
    where: { userId: { in: authorIds }, visibility: { not: "PRIVATE" } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: activitySelect,
  });

  return rows.map(toFeedItem);
}

/** One profile's own activity. */
export async function getUserActivity(userId: string, limit = 30) {
  const rows = await db.activity.findMany({
    where: { userId, visibility: "PUBLIC" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: activitySelect,
  });
  return rows.map(toFeedItem);
}

/** Site-wide activity, for signed-out visitors and the Discover sidebar. */
export async function getGlobalActivity(limit = 20) {
  const rows = await db.activity.findMany({
    where: { visibility: "PUBLIC" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: activitySelect,
  });
  return rows.map(toFeedItem);
}

// ---------------------------------------------------------------------------
// Follows
// ---------------------------------------------------------------------------

export async function listFollowers(userId: string, limit = 50) {
  const rows = await db.follow.findMany({
    where: { followingId: userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { follower: { select: { ...actorSelect, stats: { select: { level: true } } } } },
  });
  return rows.map((r) => ({ ...toActor(r.follower), level: r.follower.stats?.level ?? 1 }));
}

export async function listFollowing(userId: string, limit = 50) {
  const rows = await db.follow.findMany({
    where: { followerId: userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { following: { select: { ...actorSelect, stats: { select: { level: true } } } } },
  });
  return rows.map((r) => ({ ...toActor(r.following), level: r.following.stats?.level ?? 1 }));
}

/** Suggested people: the highest-XP users the viewer is not already following. */
export async function suggestedUsers(viewerId: string, limit = 8) {
  const following = await db.follow.findMany({
    where: { followerId: viewerId },
    select: { followingId: true },
  });

  const exclude = [...following.map((f) => f.followingId), viewerId];

  const rows = await db.userStats.findMany({
    where: { userId: { notIn: exclude }, user: { isBanned: false } },
    orderBy: { xpTotal: "desc" },
    take: limit,
    select: {
      level: true,
      episodesWatched: true,
      user: { select: actorSelect },
    },
  });

  return rows.map((r) => ({
    ...toActor(r.user),
    level: r.level,
    episodesWatched: r.episodesWatched,
  }));
}

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

export const LEADERBOARD_METRICS = {
  xpTotal: { label: "XP", suffix: "XP" },
  episodesWatched: { label: "Episodes", suffix: "episodes" },
  showsCompleted: { label: "Shows", suffix: "shows" },
  animeCompleted: { label: "Anime", suffix: "anime" },
  tvCompleted: { label: "TV", suffix: "shows" },
  minutesWatched: { label: "Hours", suffix: "minutes" },
  currentStreak: { label: "Streak", suffix: "days" },
  longestStreak: { label: "Best streak", suffix: "days" },
} as const;

export type LeaderboardMetric = keyof typeof LEADERBOARD_METRICS;

export function isLeaderboardMetric(value: string): value is LeaderboardMetric {
  return Object.prototype.hasOwnProperty.call(LEADERBOARD_METRICS, value);
}

export async function getLeaderboard(metric: LeaderboardMetric, limit = 50) {
  const rows = await db.userStats.findMany({
    where: { user: { isBanned: false }, [metric]: { gt: 0 } },
    orderBy: { [metric]: "desc" },
    take: limit,
    select: {
      userId: true,
      xpTotal: true,
      level: true,
      episodesWatched: true,
      showsCompleted: true,
      animeCompleted: true,
      tvCompleted: true,
      minutesWatched: true,
      currentStreak: true,
      longestStreak: true,
      rank: { select: { name: true, icon: true } },
      user: { select: actorSelect },
    },
  });

  return rows.map((row, index) => ({
    position: index + 1,
    userId: row.userId,
    value: row[metric],
    level: row.level,
    rankName: row.rank?.name ?? null,
    rankIcon: row.rank?.icon ?? null,
    ...toActor(row.user),
  }));
}

export type LeaderboardRow = Awaited<ReturnType<typeof getLeaderboard>>[number];
