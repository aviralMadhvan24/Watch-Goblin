import { describe, expect, it } from "vitest";

import { catalogService } from "@/server/services/catalog.service";
import { fuzzyShowIds } from "@/server/queries/search";
import { discoverShows } from "@/server/queries/shows";

import { showDetail } from "./factories";

/**
 * Fuzzy search, against a real database because the whole feature *is* a
 * Postgres extension: `word_similarity` lives in pg_trgm, and a mocked version
 * of it would only prove that the mock agrees with itself.
 */

async function seedCatalogue() {
  const titles: [string, string?][] = [
    ["Attack on Titan"],
    ["Jujutsu Kaisen"],
    ["Demon Slayer"],
    ["One Piece"],
    ["Breaking Bad"],
    ["Frieren: Beyond Journey's End", "Sousou no Frieren"],
  ];

  for (const [index, [title, originalTitle]] of titles.entries()) {
    await catalogService.importShow({
      ...showDetail({ title, seasons: [2], externalId: `seed-${index}` }),
      originalTitle: originalTitle ?? null,
    });
  }
}

describe("exact search", () => {
  it("finds a show by a substring of its title", async () => {
    await seedCatalogue();

    const { shows, didYouMean } = await discoverShows({ q: "titan" });

    expect(shows.map((s) => s.title)).toContain("Attack on Titan");
    // A real match must never be presented as a guess.
    expect(didYouMean).toBeNull();
  });

  it("is case insensitive", async () => {
    await seedCatalogue();

    const { shows } = await discoverShows({ q: "BREAKING bad" });
    expect(shows.map((s) => s.title)).toContain("Breaking Bad");
  });

  it("searches the original title too", async () => {
    await seedCatalogue();

    const { shows } = await discoverShows({ q: "sousou" });
    expect(shows.map((s) => s.title)).toContain("Frieren: Beyond Journey's End");
  });
});

describe("fuzzy fallback", () => {
  it("recovers from a typo the exact search cannot match", async () => {
    await seedCatalogue();

    const { shows, didYouMean } = await discoverShows({ q: "atack on titan" });

    expect(shows[0]?.title).toBe("Attack on Titan");
    // Flagged, because these are answers to a question the user did not ask.
    expect(didYouMean).toBe("Attack on Titan");
  });

  it("handles a transposed and misspelled title", async () => {
    await seedCatalogue();

    const { shows } = await discoverShows({ q: "jujutsu kaisan" });
    expect(shows[0]?.title).toBe("Jujutsu Kaisen");
  });

  it("handles a dropped letter", async () => {
    await seedCatalogue();

    // 0.58 similarity — below Postgres' own 0.6 default, which is exactly why
    // the threshold was lowered.
    const { shows } = await discoverShows({ q: "one pece" });
    expect(shows[0]?.title).toBe("One Piece");
  });

  it("handles a missing space", async () => {
    await seedCatalogue();

    const { shows } = await discoverShows({ q: "brakingbad" });
    expect(shows[0]?.title).toBe("Breaking Bad");
  });

  it("does not fire when the exact search already found something", async () => {
    await seedCatalogue();

    const { didYouMean } = await discoverShows({ q: "demon" });
    expect(didYouMean).toBeNull();
  });

  it("returns nothing for a query that resembles nothing", async () => {
    await seedCatalogue();

    const { shows, didYouMean } = await discoverShows({ q: "zzzqqqxxwv" });
    expect(shows).toHaveLength(0);
    expect(didYouMean).toBeNull();
  });

  it("still honours the type filter", async () => {
    await seedCatalogue();
    await catalogService.importShow(
      showDetail({ title: "Attack on Titan Live", type: "TV", externalId: "tv-1" }),
    );

    const { shows } = await discoverShows({ q: "atack on titan", type: "TV" });

    expect(shows.length).toBeGreaterThan(0);
    expect(shows.every((s) => s.type === "TV")).toBe(true);
  });
});

describe("fuzzyShowIds", () => {
  it("ignores queries too short to be meaningful", async () => {
    await seedCatalogue();

    // A single character is similar to almost everything; matching on it would
    // return the catalogue in arbitrary order.
    expect(await fuzzyShowIds("a")).toEqual([]);
  });

  it("ranks the closest title first", async () => {
    await seedCatalogue();

    const matches = await fuzzyShowIds("demn slayer");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].score).toBeGreaterThan(0.45);
  });
});
