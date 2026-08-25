import { describe, expect, it } from "vitest";

import { buildGenreAffinity, type LibraryEntryForAffinity } from "@/server/queries/recommendations";

/**
 * The taste vector.
 *
 * This is the piece where a wrong sign or a missing normalisation produces
 * recommendations that look plausible and are quietly backwards — a user who
 * dropped every horror show being recommended horror, and nobody able to tell
 * from the output that it is inverted rather than just bad. So the sign and the
 * scale are asserted directly.
 */

// Flat IDF: every genre equally informative, so these tests isolate the opinion
// maths. The rarity weighting gets its own block below.
const flatIdf = new Map([
  ["action", 1],
  ["comedy", 1],
  ["horror", 1],
  ["mystery", 1],
]);

function entry(over: Partial<LibraryEntryForAffinity> = {}): LibraryEntryForAffinity {
  return {
    showId: "show-1",
    status: "COMPLETED",
    rating: null,
    genreIds: ["action"],
    ...over,
  };
}

describe("buildGenreAffinity", () => {
  it("returns nothing for an empty library", () => {
    expect(buildGenreAffinity([], flatIdf).weights.size).toBe(0);
  });

  it("treats a completed show as a positive signal", () => {
    const { weights } = buildGenreAffinity([entry()], flatIdf);
    expect(weights.get("action")).toBeGreaterThan(0);
  });

  it("treats a dropped show as a negative signal", () => {
    const { weights } = buildGenreAffinity([entry({ status: "DROPPED" })], flatIdf);
    expect(weights.get("action")).toBeLessThan(0);
  });

  it("lets an explicit rating override the status", () => {
    // Finishing a show you rated one star is not an endorsement of its genres.
    const { weights } = buildGenreAffinity(
      [entry({ status: "COMPLETED", rating: 1 })],
      flatIdf,
    );
    expect(weights.get("action")).toBeLessThan(0);
  });

  it("treats a three-star rating as no opinion at all", () => {
    const { weights } = buildGenreAffinity(
      [entry({ status: "COMPLETED", rating: 3 })],
      flatIdf,
    );
    expect(weights.get("action")).toBeUndefined();
  });

  it("splits one show's opinion across its genres", () => {
    // Otherwise a six-genre show counts six times as hard as a focused one.
    const focused = buildGenreAffinity(
      [entry({ showId: "a", genreIds: ["action"] })],
      flatIdf,
    );
    const broad = buildGenreAffinity(
      [entry({ showId: "b", genreIds: ["action", "comedy", "horror", "mystery"] })],
      flatIdf,
    );

    // Both normalise to a peak of 1, so compare the *shape*: the broad show
    // spreads evenly, the focused one concentrates.
    expect(focused.weights.get("action")).toBe(1);
    expect([...broad.weights.values()].every((w) => Math.abs(w - 1) < 1e-9)).toBe(true);
    expect(broad.weights.size).toBe(4);
  });

  it("ranks a genre the user likes twice above one they like once", () => {
    const { weights } = buildGenreAffinity(
      [
        entry({ showId: "a", genreIds: ["action"], rating: 5 }),
        entry({ showId: "b", genreIds: ["action"], rating: 5 }),
        entry({ showId: "c", genreIds: ["comedy"], rating: 5 }),
      ],
      flatIdf,
    );

    expect(weights.get("action")!).toBeGreaterThan(weights.get("comedy")!);
  });

  it("normalises the strongest genre to 1 regardless of library size", () => {
    const small = buildGenreAffinity([entry({ rating: 5 })], flatIdf);
    const large = buildGenreAffinity(
      Array.from({ length: 200 }, (_, i) => entry({ showId: `s${i}`, rating: 5 })),
      flatIdf,
    );

    expect(small.weights.get("action")).toBeCloseTo(1, 10);
    expect(large.weights.get("action")).toBeCloseTo(1, 10);
  });

  it("discounts a genre that sits on most of the catalogue", () => {
    // The real failure this prevents: "Animation" is on 60% of this catalogue,
    // so without rarity weighting every anime fan is recommended every anime.
    const idf = new Map([
      ["animation", Math.log(1837 / 1109)], // ~0.50, on most shows
      ["mystery", Math.log(1837 / 242)], //   ~2.03, on few
    ]);

    const { weights } = buildGenreAffinity(
      [
        entry({ showId: "a", genreIds: ["animation"], rating: 5 }),
        entry({ showId: "b", genreIds: ["mystery"], rating: 5 }),
      ],
      idf,
    );

    expect(weights.get("mystery")!).toBeGreaterThan(weights.get("animation")!);
  });

  it("survives a genre missing from the IDF table", () => {
    // A genre imported after the IDF snapshot must not produce NaN and poison
    // every comparison downstream.
    const { weights } = buildGenreAffinity(
      [entry({ genreIds: ["brand-new-genre"] })],
      flatIdf,
    );

    expect(Number.isFinite(weights.get("brand-new-genre")!)).toBe(true);
  });

  it("ignores shows carrying no genres", () => {
    expect(buildGenreAffinity([entry({ genreIds: [] })], flatIdf).weights.size).toBe(0);
  });

  it("records which show drove each genre, strongest first", () => {
    const { drivers } = buildGenreAffinity(
      [
        entry({ showId: "meh", genreIds: ["action"], rating: 3.5 }),
        entry({ showId: "loved", genreIds: ["action"], rating: 5 }),
      ],
      flatIdf,
    );

    expect(drivers.get("action")!.map((d) => d.showId)).toEqual(["loved", "meh"]);
  });
});
