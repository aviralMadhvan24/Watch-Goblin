import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TmdbMetadataProvider } from "@/server/integrations/metadata/tmdb.provider";

/**
 * The provider's two pieces of real judgement are tested here: the anime
 * heuristic (Japanese AND animated, because TMDB has no "is anime" flag) and
 * the pornography gate (keyword ids, with a runtime tie-breaker for the one
 * ambiguous tag). Both are documented in the provider with specific titles they
 * must and must not catch; those titles are the fixtures below.
 *
 * `fetch` is stubbed rather than mocked at the module level, so everything from
 * URL construction through response mapping is exercised for real.
 */

const HENTAI_KEYWORD = 198385;
const EROTIC_KEYWORD = 256466;
const ECCHI_KEYWORD = 3204;
const ANIMATION_GENRE = 16;

interface TmdbFixture {
  id: number;
  name: string;
  original_language?: string;
  genre_ids?: number[];
  keywordIds?: number[];
  episode_run_time?: number[];
  seasons?: { season_number: number; episodes?: number }[];
}

/**
 * Routes a request to the right fixture by path, so the provider's own URL
 * building is part of what is under test — a typo in a path shows up as a
 * missing fixture rather than passing silently.
 */
function stubTmdb(fixtures: TmdbFixture[]) {
  const byId = new Map(fixtures.map((fixture) => [String(fixture.id), fixture]));

  const json = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL) => {
      const url = new URL(String(input));
      const path = url.pathname.replace(/^\/3/, "");

      if (path === "/search/tv" || path === "/discover/tv" || path === "/trending/tv/week") {
        return json({
          results: fixtures.map((fixture) => ({
            id: fixture.id,
            name: fixture.name,
            original_language: fixture.original_language ?? "en",
            genre_ids: fixture.genre_ids ?? [],
            overview: "",
            popularity: 10,
          })),
        });
      }

      const seasonMatch = /^\/tv\/(\d+)\/season\/(\d+)$/.exec(path);
      if (seasonMatch) {
        const [, , seasonNumber] = seasonMatch;
        return json({
          season_number: Number(seasonNumber),
          name: `Season ${seasonNumber}`,
          episodes: [
            { episode_number: 1, name: "One", runtime: 24, air_date: "2026-01-05" },
            { episode_number: 2, name: "Two", runtime: 24, air_date: "2026-01-12" },
          ],
        });
      }

      const detailMatch = /^\/tv\/(\d+)$/.exec(path);
      if (detailMatch) {
        const fixture = byId.get(detailMatch[1]);
        if (!fixture) {
          return Promise.resolve(new Response(JSON.stringify({ success: false }), { status: 404 }));
        }

        return json({
          id: fixture.id,
          name: fixture.name,
          original_language: fixture.original_language ?? "en",
          genres: (fixture.genre_ids ?? []).map((genreId) => ({ id: genreId, name: "Animation" })),
          episode_run_time: fixture.episode_run_time,
          keywords: { results: (fixture.keywordIds ?? []).map((id) => ({ id, name: "kw" })) },
          seasons: fixture.seasons ?? [{ season_number: 1 }],
          credits: { cast: [{ name: "A Voice Actor", character: "Someone", order: 0 }] },
          networks: [{ name: "A Network" }],
          number_of_seasons: 1,
          number_of_episodes: 2,
        });
      }

      // Anything else is a real 404 from TMDB, which `request` turns into null.
      return Promise.resolve(new Response(JSON.stringify({ success: false }), { status: 404 }));
    }),
  );
}

const provider = new TmdbMetadataProvider();

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("anime classification", () => {
  it("treats a Japanese animated show as ANIME", async () => {
    stubTmdb([
      { id: 1, name: "Frieren", original_language: "ja", genre_ids: [ANIMATION_GENRE] },
    ]);

    const [show] = await provider.search({ query: "frieren" });
    expect(show.type).toBe("ANIME");
  });

  it("treats Western animation as TV, not anime", async () => {
    // The provider's comment names Arcane specifically: animated but not
    // Japanese, so a genre-only rule would misfile it.
    stubTmdb([{ id: 2, name: "Arcane", original_language: "en", genre_ids: [ANIMATION_GENRE] }]);

    const [show] = await provider.search({ query: "arcane" });
    expect(show.type).toBe("TV");
  });

  it("treats Japanese live action as TV, not anime", async () => {
    stubTmdb([{ id: 3, name: "Shogun", original_language: "ja", genre_ids: [18] }]);

    const [show] = await provider.search({ query: "shogun" });
    expect(show.type).toBe("TV");
  });

  it("honours a requested type filter", async () => {
    stubTmdb([
      { id: 1, name: "Frieren", original_language: "ja", genre_ids: [ANIMATION_GENRE] },
      { id: 2, name: "Arcane", original_language: "en", genre_ids: [ANIMATION_GENRE] },
    ]);

    const results = await provider.search({ query: "a", type: "ANIME" });
    expect(results.map((show) => show.title)).toEqual(["Frieren"]);
  });
});

describe("pornography gate", () => {
  it("rejects an explicit keyword outright", () => {
    expect(provider.isPornographic({ id: 1, name: "x" }, [HENTAI_KEYWORD])).toBe(true);
  });

  it("passes a show with no flagged keywords", () => {
    expect(provider.isPornographic({ id: 1, name: "x" }, [ECCHI_KEYWORD])).toBe(false);
  });

  it("rejects `erotic` on a short-runtime OVA", () => {
    expect(
      provider.isPornographic({ id: 1, name: "x", episode_run_time: [12] }, [EROTIC_KEYWORD]),
    ).toBe(true);
  });

  it("allows `erotic` on a full broadcast slot", () => {
    // Mushoku Tensei carries this tag and must survive the filter.
    expect(
      provider.isPornographic({ id: 1, name: "x", episode_run_time: [24] }, [EROTIC_KEYWORD]),
    ).toBe(false);
  });

  it("treats a missing runtime as short, which is the category's signature", () => {
    expect(provider.isPornographic({ id: 1, name: "x" }, [EROTIC_KEYWORD])).toBe(true);
  });

  it("uses the longest runtime when several are listed", () => {
    expect(
      provider.isPornographic({ id: 1, name: "x", episode_run_time: [12, 25] }, [EROTIC_KEYWORD]),
    ).toBe(false);
  });

  it("filters flagged titles out of search results", async () => {
    stubTmdb([
      { id: 1, name: "Frieren", original_language: "ja", genre_ids: [ANIMATION_GENRE] },
      {
        id: 9,
        name: "Something Explicit",
        original_language: "ja",
        genre_ids: [ANIMATION_GENRE],
        keywordIds: [HENTAI_KEYWORD],
      },
    ]);

    const results = await provider.search({ query: "a" });
    expect(results.map((show) => show.title)).toEqual(["Frieren"]);
  });

  it("refuses to return detail for a flagged title, so no import path can bypass it", async () => {
    stubTmdb([
      {
        id: 9,
        name: "Something Explicit",
        original_language: "ja",
        genre_ids: [ANIMATION_GENRE],
        keywordIds: [HENTAI_KEYWORD],
      },
    ]);

    expect(await provider.getShow("9")).toBeNull();
  });
});

describe("getShow", () => {
  it("maps seasons and episodes, skipping specials", async () => {
    stubTmdb([
      {
        id: 1,
        name: "Frieren",
        original_language: "ja",
        genre_ids: [ANIMATION_GENRE],
        seasons: [{ season_number: 0 }, { season_number: 1 }, { season_number: 2 }],
      },
    ]);

    const detail = await provider.getShow("1");

    // Season 0 distorts completion percentages, so it is never imported.
    expect(detail?.seasons.map((season) => season.number)).toEqual([1, 2]);
    expect(detail?.seasons[0].episodes).toHaveLength(2);
    expect(detail?.seasons[0].episodes[0]).toMatchObject({ number: 1, title: "One" });
  });

  it("reads cast from the appended credits rather than a second request", async () => {
    stubTmdb([
      { id: 1, name: "Frieren", original_language: "ja", genre_ids: [ANIMATION_GENRE] },
    ]);

    const detail = await provider.getShow("1");
    expect(detail?.cast[0]).toMatchObject({ name: "A Voice Actor", character: "Someone" });

    // One detail call and one per season — no separate `/credits` round trip.
    const paths = vi
      .mocked(fetch)
      .mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths.filter((path) => path.endsWith("/credits"))).toHaveLength(0);
  });

  it("returns null when the provider has no such id", async () => {
    stubTmdb([]);
    expect(await provider.getShow("404")).toBeNull();
  });
});
