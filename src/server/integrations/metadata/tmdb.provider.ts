import "server-only";

import { env } from "@/config/env.server";
import type { AiringStatus, ShowType } from "@/generated/prisma/enums";
import { logger } from "@/lib/logger";

import type {
  ExternalEpisode,
  ExternalSeason,
  ExternalShowDetail,
  ExternalShowSummary,
  MetadataProvider,
  SearchOptions,
} from "./types";

/**
 * TMDB-backed provider.
 *
 * Everything TMDB-shaped is confined to this file: its field names, its image
 * path convention, its status strings and its genre ids. Above the
 * `MetadataProvider` boundary the rest of the app only ever sees our own types,
 * which is why switching to AniList/Jikan/TVDB later is a new file plus one
 * line in the factory.
 *
 * The anime split is a heuristic — TMDB has no "is anime" flag, so a show is
 * treated as anime when it is Japanese *and* carries the Animation genre. That
 * is the same rule the major trackers use and it is right the overwhelming
 * majority of the time; the alternative would be a manual override table,
 * which the MVP does not need.
 */

const ANIMATION_GENRE_ID = 16;

interface TmdbShow {
  id: number;
  name: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string;
  last_air_date?: string;
  status?: string;
  number_of_seasons?: number;
  number_of_episodes?: number;
  episode_run_time?: number[];
  original_language?: string;
  popularity?: number;
  vote_average?: number;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  networks?: { name: string }[];
  production_companies?: { name: string }[];
  seasons?: { season_number: number; name?: string; overview?: string; poster_path?: string | null; air_date?: string }[];
}

export class TmdbMetadataProvider implements MetadataProvider {
  readonly name = "tmdb";

  private async request<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
    const url = new URL(`${env.TMDB_API_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${env.TMDB_API_KEY}`,
          accept: "application/json",
        },
        // Catalogue metadata is not volatile; caching keeps us well inside the
        // provider's rate limits and makes show pages fast.
        next: { revalidate: 60 * 60 * 6 },
      });

      if (!response.ok) {
        logger.warn("TMDB request failed", { path, status: response.status });
        return null;
      }

      return (await response.json()) as T;
    } catch (error) {
      logger.error("TMDB request threw", error, { path });
      return null;
    }
  }

  async search({ query, type, limit = 20 }: SearchOptions): Promise<ExternalShowSummary[]> {
    const data = await this.request<{ results: TmdbShow[] }>("/search/tv", {
      query,
      include_adult: "false",
    });
    if (!data) return [];

    return data.results
      .map((show) => this.toSummary(show))
      .filter((show) => (type ? show.type === type : true))
      .slice(0, limit);
  }

  async getShow(externalId: string): Promise<ExternalShowDetail | null> {
    const show = await this.request<TmdbShow>(`/tv/${externalId}`, {
      append_to_response: "credits",
    });
    if (!show) return null;

    const summary = this.toSummary(show);

    // Episode lists are a request per season; fetched in parallel, and specials
    // (season 0) are skipped because they distort completion percentages.
    const seasonNumbers = (show.seasons ?? [])
      .map((season) => season.season_number)
      .filter((number) => number > 0);

    const seasons = await Promise.all(
      seasonNumbers.map((number) => this.getSeason(externalId, number)),
    );

    const credits = await this.request<{
      cast?: { name: string; character?: string; profile_path?: string | null; order?: number }[];
    }>(`/tv/${externalId}/credits`);

    return {
      ...summary,
      credits: [
        ...(show.networks ?? []).map((n) => ({ name: n.name, kind: "NETWORK" as const })),
        ...(show.production_companies ?? []).map((c) => ({ name: c.name, kind: "STUDIO" as const })),
      ],
      seasons: seasons.filter((season): season is ExternalSeason => season !== null),
      cast: (credits?.cast ?? []).slice(0, 20).map((member, index) => ({
        name: member.name,
        character: member.character ?? null,
        photoUrl: imageUrl(member.profile_path, "w185"),
        order: member.order ?? index,
      })),
    };
  }

  private async getSeason(showId: string, seasonNumber: number): Promise<ExternalSeason | null> {
    const data = await this.request<{
      season_number: number;
      name?: string;
      overview?: string;
      poster_path?: string | null;
      air_date?: string;
      episodes?: {
        episode_number: number;
        name?: string;
        overview?: string;
        air_date?: string;
        runtime?: number | null;
        still_path?: string | null;
      }[];
    }>(`/tv/${showId}/season/${seasonNumber}`);

    if (!data) return null;

    const episodes: ExternalEpisode[] = (data.episodes ?? []).map((episode) => ({
      number: episode.episode_number,
      title: episode.name ?? null,
      overview: episode.overview || null,
      airDate: parseDate(episode.air_date),
      runtimeMinutes: episode.runtime ?? null,
      stillUrl: imageUrl(episode.still_path, "w300"),
    }));

    return {
      number: data.season_number,
      title: data.name ?? null,
      overview: data.overview || null,
      posterUrl: imageUrl(data.poster_path, "w342"),
      airDate: parseDate(data.air_date),
      episodes,
    };
  }

  async trending({
    type,
    limit = 20,
  }: { type?: ShowType; limit?: number } = {}): Promise<ExternalShowSummary[]> {
    const data = await this.request<{ results: TmdbShow[] }>("/trending/tv/week");
    if (!data) return [];

    return data.results
      .map((show) => this.toSummary(show))
      .filter((show) => (type ? show.type === type : true))
      .slice(0, limit);
  }

  private toSummary(show: TmdbShow): ExternalShowSummary {
    const genreNames = show.genres?.map((genre) => genre.name) ?? [];
    const genreIds = show.genre_ids ?? show.genres?.map((genre) => genre.id) ?? [];

    const isJapanese = show.original_language === "ja";
    const isAnimated =
      genreIds.includes(ANIMATION_GENRE_ID) || genreNames.includes("Animation");

    return {
      externalId: String(show.id),
      provider: this.name,
      type: isJapanese && isAnimated ? "ANIME" : "TV",
      title: show.name,
      originalTitle: show.original_name ?? null,
      synopsis: show.overview || null,
      posterUrl: imageUrl(show.poster_path, "w500"),
      backdropUrl: imageUrl(show.backdrop_path, "w1280"),
      firstAirDate: parseDate(show.first_air_date),
      lastAirDate: parseDate(show.last_air_date),
      airingStatus: mapStatus(show.status),
      totalSeasons: show.number_of_seasons ?? 0,
      totalEpisodes: show.number_of_episodes ?? 0,
      averageRuntimeMinutes: show.episode_run_time?.[0] ?? (isJapanese && isAnimated ? 24 : 45),
      originalLanguage: show.original_language ?? "en",
      popularity: show.popularity ?? 0,
      externalRating: show.vote_average ?? null,
      genres: genreNames,
    };
  }
}

function imageUrl(path: string | null | undefined, size: string): string | null {
  if (!path) return null;
  return `${env.TMDB_IMAGE_BASE_URL}/${size}${path}`;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapStatus(status: string | undefined): AiringStatus {
  switch (status) {
    case "Returning Series":
    case "In Production":
      return "AIRING";
    case "Planned":
    case "Pilot":
      return "UPCOMING";
    case "Canceled":
      return "CANCELLED";
    case "Ended":
    default:
      return "ENDED";
  }
}
