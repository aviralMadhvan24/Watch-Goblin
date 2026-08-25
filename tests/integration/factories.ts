import { db } from "@/db/client";
import type { ExternalShowDetail } from "@/server/integrations/metadata";
import { catalogService } from "@/server/services/catalog.service";

/**
 * Fixtures for the integration suite.
 *
 * Shows are built through `catalogService.importShow` rather than by inserting
 * rows directly, so every test starts from a catalogue that was produced the
 * same way production's is — totals, slugs and the season tree included. A test
 * asserting progress against hand-inserted rows could pass while the real
 * import path was broken.
 */

let sequence = 0;
const nextId = () => `${Date.now().toString(36)}-${(sequence += 1)}`;

export async function createUser(overrides: { username?: string } = {}) {
  const id = nextId();
  const username = overrides.username ?? `user-${id}`;

  const user = await db.user.create({
    data: {
      email: `${username}@example.test`,
      username,
      // Not a real hash: nothing in these tests authenticates, and running
      // bcrypt at cost 12 per fixture would dominate the suite's runtime.
      passwordHash: "not-a-real-hash",
      profile: { create: { displayName: username } },
      stats: { create: {} },
      streak: { create: {} },
    },
    select: { id: true, username: true },
  });

  return user;
}

export interface ShowSpec {
  title?: string;
  type?: "ANIME" | "TV";
  /** Episode counts per season, in order, starting at season 1. */
  seasons?: number[];
  /** Adds a season 0. Specials are trackable but never count toward totals. */
  specials?: number;
  externalId?: string;
  runtimeMinutes?: number;
}

/** Builds the provider payload for a show, without touching the network. */
export function showDetail(spec: ShowSpec = {}): ExternalShowDetail {
  const title = spec.title ?? `Test Show ${nextId()}`;
  const runtime = spec.runtimeMinutes ?? 24;
  const counts = spec.seasons ?? [3];

  const seasons = counts.map((episodeCount, index) => ({
    number: index + 1,
    title: `Season ${index + 1}`,
    overview: null,
    posterUrl: null,
    airDate: new Date("2026-01-01T00:00:00Z"),
    episodes: Array.from({ length: episodeCount }, (_, episodeIndex) => ({
      number: episodeIndex + 1,
      title: `S${index + 1}E${episodeIndex + 1}`,
      overview: null,
      airDate: new Date("2026-01-01T00:00:00Z"),
      runtimeMinutes: runtime,
      stillUrl: null,
    })),
  }));

  if (spec.specials) {
    seasons.unshift({
      number: 0,
      title: "Specials",
      overview: null,
      posterUrl: null,
      airDate: new Date("2026-01-01T00:00:00Z"),
      episodes: Array.from({ length: spec.specials }, (_, episodeIndex) => ({
        number: episodeIndex + 1,
        title: `Special ${episodeIndex + 1}`,
        overview: null,
        airDate: new Date("2026-01-01T00:00:00Z"),
        runtimeMinutes: runtime,
        stillUrl: null,
      })),
    });
  }

  return {
    externalId: spec.externalId ?? nextId(),
    provider: "test",
    type: spec.type ?? "ANIME",
    title,
    originalTitle: null,
    synopsis: "A show that exists only in a test database.",
    posterUrl: null,
    backdropUrl: null,
    firstAirDate: new Date("2026-01-01T00:00:00Z"),
    lastAirDate: null,
    airingStatus: "ENDED",
    totalSeasons: seasons.filter((season) => season.number > 0).length,
    totalEpisodes: seasons
      .filter((season) => season.number > 0)
      .reduce((sum, season) => sum + season.episodes.length, 0),
    averageRuntimeMinutes: runtime,
    originalLanguage: "ja",
    popularity: 100,
    externalRating: 8.5,
    genres: ["Animation", "Drama"],
    credits: [{ name: "Test Studio", kind: "STUDIO" }],
    seasons,
    cast: [{ name: "Test Actor", character: "Themselves", photoUrl: null, order: 0 }],
  };
}

/** Imports a show and returns its row plus its episodes in broadcast order. */
export async function createShow(spec: ShowSpec = {}) {
  const showId = await catalogService.importShow(showDetail(spec));

  const show = await db.show.findUniqueOrThrow({
    where: { id: showId },
    select: { id: true, slug: true, title: true, type: true, totalEpisodes: true, totalSeasons: true },
  });

  const episodes = await db.episode.findMany({
    where: { showId },
    orderBy: [{ seasonNumber: "asc" }, { number: "asc" }],
    select: { id: true, number: true, seasonNumber: true, seasonId: true, runtimeMinutes: true },
  });

  return { ...show, episodes };
}
