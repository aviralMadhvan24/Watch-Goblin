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

/**
 * Pornographic titles are not flagged `adult: true` on TMDB's TV endpoints —
 * that flag is effectively only maintained for movies — so `include_adult=false`
 * does not filter them out. Sorting anime by `popularity.desc` therefore surfaces
 * hentai on the first page of results, because TMDB popularity is driven partly
 * by search traffic rather than by audience size.
 *
 * Keywords are the reliable signal. Every id here names porn outright, so
 * excluding them costs no legitimate catalogue. Notably absent:
 *   - `ecchi` / `erotic` — mainstream shows carry these (Mushoku Tensei is
 *     tagged `erotic`), so excluding them outright would drop real shows.
 *   - `adult animation` — that is Rick and Morty and BoJack, not porn.
 *   - `porn star` / `porn parody` — a drama *about* the industry is not porn.
 */
const PORN_KEYWORD_IDS = [
  198385, // hentai
  378816, // animated porn
  155477, // softcore
  445, // pornography
  356759, // porn
  154986, // gonzo pornography
  238355, // gay pornography
  335703, // trans pornography
  325693, // erotica
  238059, // gay erotica
  219371, // vintage erotica
  355313, // lesbian erotica
  350793, // greek erotica
  334900, // swedish erotica
  377295, // eroge
] as const;

/**
 * The residual case: softcore anime OVAs that carry only `erotic`, which on its
 * own is worthless as a filter — Mushoku Tensei has it too.
 *
 * Two things make this tractable. First, `erotic` is in practice applied almost
 * exclusively to anime: none of Game of Thrones, Euphoria, Bridgerton, Sex/Life
 * or Outlander carries it. Second, within anime the tag splits cleanly on
 * length — the softcore OVAs run 5-15 minute shorts (or list no runtime at all,
 * which is itself typical of the category), while the mainstream shows that
 * share the tag run a full 24-25 minute broadcast slot.
 *
 * `ecchi` is deliberately NOT here. It is the suggestive-comedy tag, worn by
 * ordinary TV anime like Princess Lover! and Adam's Sweet Agony, and treating
 * it as erotic wrongly blocks them.
 */
const EROTIC_KEYWORD_ID = 256466;
const EROTIC_SHORT_MAX_RUNTIME = 15;

/**
 * TMDB caps `/discover` at 500 pages; this is a sanity bound, not that limit.
 * 100 pages is 2,000 results per type, which is the depth at which the tail
 * stops being shows anyone tracks and starts being regional listings with no
 * episode data.
 */
const MAX_PAGES = 100;

/**
 * Genres whose programmes are broadcast daily and never "finished", so they are
 * not trackable in the sense this app means: progress, completion and a
 * per-episode history. Sorting by `popularity.desc` puts them near the top —
 * TMDB popularity rewards constant new airings — and importing them buys tens
 * of thousands of episode rows nobody will ever tick off. One earlier import
 * pulled Tagesschau alone at 21,352 episodes.
 *
 * Deliberately genre-based rather than an episode-count cap: length is not the
 * problem. One Piece and Doraemon run well past a thousand episodes and are
 * exactly the shows this catalogue exists for, while a news bulletin is junk at
 * any length. Kids/Family is also left in on purpose — Sesame Street is long,
 * but it is a real show someone might track.
 */
const UNTRACKABLE_GENRE_IDS = [
  10763, // News
  10767, // Talk
  10766, // Soap
  10764, // Reality
] as const;

/**
 * Floor on TMDB vote count, which is the cheapest available proxy for "a real
 * show with real metadata". Below roughly this mark the tail of
 * `popularity.desc` is regional broadcast listings carrying no synopsis, no
 * artwork and an empty season tree.
 *
 * Kept low on purpose. The anime pass has to reach rank ~1000 to fill its
 * quota, and obscure-but-genuine series sit in single digits there; a floor
 * tight enough to be a quality bar would starve the import instead.
 */
const MIN_VOTE_COUNT = 10;

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
  vote_count?: number;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  networks?: { name: string }[];
  production_companies?: { name: string }[];
  credits?: { cast?: { name: string; character?: string; profile_path?: string | null; order?: number }[] };
  keywords?: { results?: { id: number; name: string }[]; keywords?: { id: number; name: string }[] };
  seasons?: { season_number: number; name?: string; overview?: string; poster_path?: string | null; air_date?: string }[];
}

/** `results` is the TV keyword shape; `keywords` is the movie one. */
function keywordIdsOf(show: TmdbShow): number[] {
  return (show.keywords?.results ?? show.keywords?.keywords ?? []).map((keyword) => keyword.id);
}

export class TmdbMetadataProvider implements MetadataProvider {
  readonly name = "tmdb";

  private async request<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
    const url = new URL(`${env.TMDB_API_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    // TMDB issues two credential types and they authenticate differently:
    // the v4 "read access token" is a JWT sent as a Bearer header, while the
    // v3 "API key" is 32 hex chars and must go in the query string. The v3 key
    // is the one the TMDB settings page shows first, so accept both rather than
    // 401 on the credential most people will paste in.
    const isV4Token = env.TMDB_API_KEY?.startsWith("eyJ") ?? false;
    if (!isV4Token && env.TMDB_API_KEY) {
      url.searchParams.set("api_key", env.TMDB_API_KEY);
    }

    try {
      const response = await fetch(url, {
        headers: {
          ...(isV4Token ? { Authorization: `Bearer ${env.TMDB_API_KEY}` } : {}),
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

    const candidates = data.results
      .map((show) => this.toSummary(show))
      .filter((show) => (type ? show.type === type : true))
      .slice(0, limit);

    // `/search/tv` returns neither keywords nor runtime, so the porn gate has
    // nothing to read on its payload — a search would happily surface hentai
    // that `getShow` then refuses to import. Verify the shortlist instead:
    // it is already capped at `limit`, the lookups run concurrently, and
    // `request` caches for six hours, so a repeated search costs nothing.
    const verdicts = await Promise.all(
      candidates.map((candidate) => this.isPornographicById(candidate.externalId)),
    );

    return candidates.filter((_, index) => !verdicts[index]);
  }

  /** Porn check for a show we hold only an id for. */
  private async isPornographicById(externalId: string): Promise<boolean> {
    const show = await this.request<TmdbShow>(`/tv/${externalId}`, {
      append_to_response: "keywords",
    });
    // A failed lookup is not evidence either way; `getShow` gates it again at
    // import time, which is the point where being wrong actually matters.
    if (!show) return false;
    return this.isPornographic(show, keywordIdsOf(show));
  }

  async getShow(externalId: string): Promise<ExternalShowDetail | null> {
    const show = await this.request<TmdbShow>(`/tv/${externalId}`, {
      append_to_response: "credits,keywords",
    });
    if (!show) return null;

    // Porn is rejected here rather than at the call sites so that every route
    // into the catalogue — trending, search, a direct id import — goes through
    // one gate.
    if (this.isPornographic(show, keywordIdsOf(show))) {
      logger.info("Skipping pornographic title", { externalId, title: show.name });
      return null;
    }

    const summary = this.toSummary(show);

    // Episode lists are a request per season; fetched in parallel, and specials
    // (season 0) are skipped because they distort completion percentages.
    const seasonNumbers = (show.seasons ?? [])
      .map((season) => season.season_number)
      .filter((number) => number > 0);

    const seasons = await Promise.all(
      seasonNumbers.map((number) => this.getSeason(externalId, number)),
    );

    // Cast comes from `append_to_response=credits` on the detail request above.
    // Fetching `/tv/{id}/credits` separately would double the per-show request
    // count for a payload we have already been handed — which at catalogue-import
    // scale is thousands of avoidable calls against the rate limit.
    const credits = show.credits;

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
    // TMDB pages are 20 results, so anything past the first page needs `page`.
    // Without it a caller asking for 100 silently receives 20.
    const pages = Math.min(Math.ceil(limit / 20), MAX_PAGES);
    const collected: ExternalShowSummary[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= pages; page += 1) {
      // `/trending` has no language filter, so asking it for ANIME means
      // discarding most of every page. `/discover` can filter server-side,
      // which is both fewer requests and far deeper results.
      const data = type
        ? await this.request<{ results: TmdbShow[] }>("/discover/tv", {
            sort_by: "popularity.desc",
            page: String(page),
            include_adult: "false",
            // `include_adult` is not enough on its own — see PORN_KEYWORD_IDS.
            without_keywords: PORN_KEYWORD_IDS.join(","),
            // Keeps daily news/talk/soap/reality out of the catalogue, and the
            // metadata-less tail of `popularity.desc` with it.
            without_genres: UNTRACKABLE_GENRE_IDS.join(","),
            "vote_count.gte": String(MIN_VOTE_COUNT),
            // ANIME is filtered server-side. TV is not: `toSummary` classifies
            // anything non-Japanese as TV, and excluding the animation genre
            // here would wrongly drop Western animation like Arcane. The
            // client-side type check below handles it.
            ...(type === "ANIME"
              ? {
                  with_original_language: "ja",
                  with_genres: String(ANIMATION_GENRE_ID),
                }
              : {}),
          })
        : await this.request<{ results: TmdbShow[] }>("/trending/tv/week", {
            page: String(page),
          });

      if (!data?.results?.length) break;

      for (const show of data.results) {
        const summary = this.toSummary(show);
        if (type && summary.type !== type) continue;
        if (seen.has(summary.externalId)) continue;
        seen.add(summary.externalId);
        collected.push(summary);
        if (collected.length >= limit) return collected;
      }
    }

    return collected;
  }

  /**
   * Final gate, applied once per show at import time using the keyword list
   * appended to the detail request (so it costs no extra round trip). This is
   * what catches titles `/discover` could not filter — the untyped `/trending`
   * and `/search` endpoints accept no `without_keywords` at all.
   */
  isPornographic(show: TmdbShow, keywordIds: number[]): boolean {
    if (keywordIds.some((id) => (PORN_KEYWORD_IDS as readonly number[]).includes(id))) {
      return true;
    }

    if (!keywordIds.includes(EROTIC_KEYWORD_ID)) return false;

    // Erotic plus a short slot is the softcore-OVA signature. A missing runtime
    // counts as short: the category routinely omits it, and the tag is rare
    // enough outside anime that the mainstream cost of this is nil.
    const runtimes = show.episode_run_time ?? [];
    if (runtimes.length === 0) return true;
    return Math.max(...runtimes) <= EROTIC_SHORT_MAX_RUNTIME;
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
