import "server-only";

import { db } from "@/db/client";
import type { AiringStatus, ShowType } from "@/generated/prisma/enums";
import { normalizeLimit } from "@/lib/pagination";

/**
 * Catalogue reads.
 *
 * Kept separate from `catalog.service.ts`, which is about *importing* shows.
 * Everything here is read-only and safe to call from a server component.
 */

export type ShowSort = "popular" | "rating" | "newest" | "members" | "title";

export interface DiscoverFilters {
  q?: string;
  type?: ShowType;
  genre?: string;
  airingStatus?: AiringStatus;
  sort?: ShowSort;
  page?: number;
  perPage?: number;
}

const ORDER_BY: Record<ShowSort, Record<string, "asc" | "desc">[]> = {
  popular: [{ popularity: "desc" }],
  // A show with two 5-star ratings is not the best show ever, so ordering by
  // rating leads with vote count rather than raw average.
  rating: [{ ratingCount: "desc" }, { ratingSum: "desc" }],
  newest: [{ firstAirDate: "desc" }],
  members: [{ memberCount: "desc" }],
  title: [{ title: "asc" }],
};

export const showCardSelect = {
  id: true,
  slug: true,
  title: true,
  type: true,
  posterUrl: true,
  firstAirDate: true,
  totalEpisodes: true,
  airingStatus: true,
  ratingSum: true,
  ratingCount: true,
  memberCount: true,
} as const;

export interface ShowCardData {
  id: string;
  slug: string;
  title: string;
  type: ShowType;
  posterUrl: string | null;
  firstAirDate: Date | null;
  totalEpisodes: number;
  airingStatus: AiringStatus;
  averageRating: number | null;
  ratingCount: number;
  memberCount: number;
}

export function toShowCard(row: {
  id: string;
  slug: string;
  title: string;
  type: ShowType;
  posterUrl: string | null;
  firstAirDate: Date | null;
  totalEpisodes: number;
  airingStatus: AiringStatus;
  ratingSum: number;
  ratingCount: number;
  memberCount: number;
}): ShowCardData {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    type: row.type,
    posterUrl: row.posterUrl,
    firstAirDate: row.firstAirDate,
    totalEpisodes: row.totalEpisodes,
    airingStatus: row.airingStatus,
    averageRating: row.ratingCount > 0 ? row.ratingSum / row.ratingCount : null,
    ratingCount: row.ratingCount,
    memberCount: row.memberCount,
  };
}

export async function discoverShows(filters: DiscoverFilters) {
  const perPage = normalizeLimit(filters.perPage, 24);
  const page = Math.max(1, filters.page ?? 1);
  const sort = filters.sort ?? "popular";

  const where = {
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.airingStatus ? { airingStatus: filters.airingStatus } : {}),
    ...(filters.genre ? { genres: { some: { genre: { slug: filters.genre } } } } : {}),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" as const } },
            { originalTitle: { contains: filters.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.show.findMany({
      where,
      orderBy: ORDER_BY[sort],
      skip: (page - 1) * perPage,
      take: perPage,
      select: showCardSelect,
    }),
    db.show.count({ where }),
  ]);

  return {
    shows: rows.map(toShowCard),
    total,
    page,
    perPage,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function listGenres() {
  return db.genre.findMany({ orderBy: { name: "asc" }, select: { slug: true, name: true } });
}

/**
 * Full show page payload. When `userId` is given the viewer's own watch state
 * is folded in, and the watched-episode ids come back as a Set so the episode
 * list renders in one pass instead of a query per row.
 */
export async function getShowDetail(slug: string, userId?: string | null) {
  const show = await db.show.findUnique({
    where: { slug },
    select: {
      ...showCardSelect,
      synopsis: true,
      backdropUrl: true,
      originalTitle: true,
      lastAirDate: true,
      averageRuntimeMinutes: true,
      totalSeasons: true,
      genres: { select: { genre: { select: { slug: true, name: true } } } },
      credits: { select: { credit: { select: { name: true, kind: true } } }, take: 8 },
      cast: {
        orderBy: { order: "asc" },
        take: 12,
        select: { character: true, person: { select: { name: true, photoUrl: true } } },
      },
      seasons: {
        orderBy: { number: "asc" },
        select: {
          id: true,
          number: true,
          title: true,
          posterUrl: true,
          airDate: true,
          episodeCount: true,
          episodes: {
            orderBy: { number: "asc" },
            select: {
              id: true,
              number: true,
              seasonNumber: true,
              title: true,
              overview: true,
              stillUrl: true,
              airDate: true,
              runtimeMinutes: true,
            },
          },
        },
      },
    },
  });

  if (!show) return null;

  const [userShow, watched] = userId
    ? await Promise.all([
        db.userShow.findUnique({
          where: { userId_showId: { userId, showId: show.id } },
          select: {
            status: true,
            rating: true,
            episodesWatched: true,
            currentSeasonNumber: true,
            currentEpisodeNumber: true,
          },
        }),
        db.userEpisode.findMany({
          where: { userId, showId: show.id },
          select: { episodeId: true },
        }),
      ])
    : [null, [] as { episodeId: string }[]];

  return {
    ...toShowCard(show),
    synopsis: show.synopsis,
    backdropUrl: show.backdropUrl,
    originalTitle: show.originalTitle,
    lastAirDate: show.lastAirDate,
    averageRuntimeMinutes: show.averageRuntimeMinutes,
    totalSeasons: show.totalSeasons,
    genres: show.genres.map((g) => g.genre),
    credits: show.credits.map((c) => ({ kind: c.credit.kind, name: c.credit.name })),
    cast: show.cast.map((c) => ({
      character: c.character,
      name: c.person.name,
      photoUrl: c.person.photoUrl,
    })),
    seasons: show.seasons,
    userShow,
    watchedEpisodeIds: watched.map((w) => w.episodeId),
  };
}

export type ShowDetail = NonNullable<Awaited<ReturnType<typeof getShowDetail>>>;

/** Reviews for a show, with the viewer's own like state folded in. */
export async function listShowReviews(showId: string, viewerId?: string | null, limit = 20) {
  const reviews = await db.review.findMany({
    where: { showId, deletedAt: null },
    orderBy: [{ likeCount: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      rating: true,
      body: true,
      hasSpoilers: true,
      likeCount: true,
      commentCount: true,
      createdAt: true,
      user: {
        select: {
          username: true,
          profile: { select: { displayName: true, avatarUrl: true, accentColor: true } },
        },
      },
    },
  });

  const liked = viewerId
    ? new Set(
        (
          await db.reviewLike.findMany({
            where: { userId: viewerId, reviewId: { in: reviews.map((r) => r.id) } },
            select: { reviewId: true },
          })
        ).map((l) => l.reviewId),
      )
    : new Set<string>();

  return reviews.map((r) => ({
    id: r.id,
    rating: r.rating,
    body: r.body,
    hasSpoilers: r.hasSpoilers,
    likeCount: r.likeCount,
    commentCount: r.commentCount,
    createdAt: r.createdAt,
    likedByViewer: liked.has(r.id),
    author: {
      username: r.user.username,
      displayName: r.user.profile?.displayName ?? r.user.username,
      avatarUrl: r.user.profile?.avatarUrl ?? null,
      accentColor: r.user.profile?.accentColor ?? null,
    },
  }));
}

export type ShowReview = Awaited<ReturnType<typeof listShowReviews>>[number];

/** The viewer's own review for a show, if any — drives edit vs. create. */
export async function getViewerReview(showId: string, userId: string) {
  return db.review.findUnique({
    where: { userId_showId: { userId, showId } },
    select: { id: true, rating: true, body: true, hasSpoilers: true, deletedAt: true },
  });
}
