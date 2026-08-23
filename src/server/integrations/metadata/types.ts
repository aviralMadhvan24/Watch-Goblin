import type { AiringStatus, ShowType } from "@/generated/prisma/enums";

/**
 * The contract every metadata source must satisfy.
 *
 * This is deliberately *our* vocabulary, not any provider's. TMDB calls it
 * `first_air_date`, AniList calls it `startDate`, and neither of those names
 * appears above this boundary — the mapping happens inside each provider. That
 * is what makes the provider swappable: nothing downstream of
 * `MetadataProvider` knows which service the data came from.
 */

export interface ExternalShowSummary {
  /** Stable id *within the provider*. Paired with `provider` for uniqueness. */
  externalId: string;
  provider: string;
  type: ShowType;
  title: string;
  originalTitle?: string | null;
  synopsis?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  firstAirDate?: Date | null;
  lastAirDate?: Date | null;
  airingStatus: AiringStatus;
  totalSeasons: number;
  totalEpisodes: number;
  averageRuntimeMinutes: number;
  originalLanguage: string;
  popularity: number;
  externalRating?: number | null;
  genres: string[];
  /** Studios for anime, networks for TV. */
  credits?: { name: string; kind: "STUDIO" | "NETWORK" }[];
}

export interface ExternalEpisode {
  number: number;
  title?: string | null;
  overview?: string | null;
  airDate?: Date | null;
  runtimeMinutes?: number | null;
  stillUrl?: string | null;
}

export interface ExternalSeason {
  number: number;
  title?: string | null;
  overview?: string | null;
  posterUrl?: string | null;
  airDate?: Date | null;
  episodes: ExternalEpisode[];
}

export interface ExternalCastMember {
  name: string;
  character?: string | null;
  photoUrl?: string | null;
  order: number;
}

/** A summary plus everything needed to build a full show page. */
export interface ExternalShowDetail extends ExternalShowSummary {
  seasons: ExternalSeason[];
  cast: ExternalCastMember[];
}

export interface SearchOptions {
  query: string;
  type?: ShowType;
  limit?: number;
}

export interface DiscoverOptions {
  type?: ShowType;
  genre?: string;
  year?: number;
  minRating?: number;
  sort?: "popularity" | "rating" | "recent" | "members";
  limit?: number;
  cursor?: string;
}

export interface MetadataProvider {
  readonly name: string;

  search(options: SearchOptions): Promise<ExternalShowSummary[]>;

  /** Full detail for one show. Returns null when the provider has no such id. */
  getShow(externalId: string): Promise<ExternalShowDetail | null>;

  /** Provider-side trending/popular list, used to warm the catalogue. */
  trending(options?: { type?: ShowType; limit?: number }): Promise<ExternalShowSummary[]>;
}
