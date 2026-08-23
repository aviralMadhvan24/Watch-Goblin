import "server-only";

import { db } from "@/db/client";
import type { ShowType } from "@/generated/prisma/enums";

import type {
  ExternalShowDetail,
  ExternalShowSummary,
  MetadataProvider,
  SearchOptions,
} from "./types";

/**
 * Serves the catalogue already in our own database.
 *
 * This is the default provider, and it is not a stub: once a show has been
 * imported it *is* local data, so this is the code path the app runs on
 * day-to-day. It also means development, CI and the integration tests need no
 * API key and no network — the seeded catalogue is a complete, working
 * catalogue.
 */
export class LocalMetadataProvider implements MetadataProvider {
  readonly name = "local";

  async search({ query, type, limit = 20 }: SearchOptions): Promise<ExternalShowSummary[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const rows = await db.show.findMany({
      where: {
        ...(type ? { type } : {}),
        OR: [
          { title: { contains: trimmed, mode: "insensitive" } },
          { originalTitle: { contains: trimmed, mode: "insensitive" } },
        ],
      },
      orderBy: [{ popularity: "desc" }],
      take: limit,
      include: { genres: { include: { genre: true } } },
    });

    return rows.map(toSummary);
  }

  async getShow(externalId: string): Promise<ExternalShowDetail | null> {
    const show = await db.show.findFirst({
      // Accept either our id or our slug — callers should not have to care.
      where: { OR: [{ id: externalId }, { slug: externalId }] },
      include: {
        genres: { include: { genre: true } },
        credits: { include: { credit: true } },
        cast: { include: { person: true }, orderBy: { order: "asc" } },
        seasons: {
          orderBy: { number: "asc" },
          include: { episodes: { orderBy: { number: "asc" } } },
        },
      },
    });

    if (!show) return null;

    return {
      ...toSummary(show),
      credits: show.credits.map((row) => ({ name: row.credit.name, kind: row.credit.kind })),
      seasons: show.seasons.map((season) => ({
        number: season.number,
        title: season.title,
        overview: season.overview,
        posterUrl: season.posterUrl,
        airDate: season.airDate,
        episodes: season.episodes.map((episode) => ({
          number: episode.number,
          title: episode.title,
          overview: episode.overview,
          airDate: episode.airDate,
          runtimeMinutes: episode.runtimeMinutes,
          stillUrl: episode.stillUrl,
        })),
      })),
      cast: show.cast.map((member) => ({
        name: member.person.name,
        character: member.character,
        photoUrl: member.person.photoUrl,
        order: member.order,
      })),
    };
  }

  async trending({
    type,
    limit = 20,
  }: { type?: ShowType; limit?: number } = {}): Promise<ExternalShowSummary[]> {
    const rows = await db.show.findMany({
      where: type ? { type } : {},
      orderBy: [{ popularity: "desc" }],
      take: limit,
      include: { genres: { include: { genre: true } } },
    });
    return rows.map(toSummary);
  }
}

type ShowRow = {
  id: string;
  type: ShowType;
  title: string;
  originalTitle: string | null;
  synopsis: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  firstAirDate: Date | null;
  lastAirDate: Date | null;
  airingStatus: ExternalShowSummary["airingStatus"];
  totalSeasons: number;
  totalEpisodes: number;
  averageRuntimeMinutes: number;
  originalLanguage: string;
  popularity: number;
  externalRating: number | null;
  genres: { genre: { name: string } }[];
};

function toSummary(show: ShowRow): ExternalShowSummary {
  return {
    externalId: show.id,
    provider: "local",
    type: show.type,
    title: show.title,
    originalTitle: show.originalTitle,
    synopsis: show.synopsis,
    posterUrl: show.posterUrl,
    backdropUrl: show.backdropUrl,
    firstAirDate: show.firstAirDate,
    lastAirDate: show.lastAirDate,
    airingStatus: show.airingStatus,
    totalSeasons: show.totalSeasons,
    totalEpisodes: show.totalEpisodes,
    averageRuntimeMinutes: show.averageRuntimeMinutes,
    originalLanguage: show.originalLanguage,
    popularity: show.popularity,
    externalRating: show.externalRating,
    genres: show.genres.map((row) => row.genre.name),
  };
}
