import { describe, expect, it } from "vitest";

import { chunk, clamp, percentage, pickDeterministic, slugify, unique } from "@/lib/utils";

/**
 * `slugify` produces the public URL of every show, and the catalogue's
 * uniqueness story depends on it being stable and ASCII — a slug that changes
 * shape between releases breaks every link that ever pointed at it.
 */
describe("slugify", () => {
  it("lower-cases and hyphenates", () => {
    expect(slugify("Attack on Titan")).toBe("attack-on-titan");
  });

  it("strips diacritics rather than dropping the letter", () => {
    expect(slugify("Pokémon")).toBe("pokemon");
  });

  it("removes apostrophes instead of turning them into hyphens", () => {
    expect(slugify("Frieren: Beyond Journey’s End")).toBe("frieren-beyond-journeys-end");
    expect(slugify("Grey's Anatomy")).toBe("greys-anatomy");
  });

  it("collapses runs of punctuation and trims the edges", () => {
    expect(slugify("  ***Cowboy   Bebop***  ")).toBe("cowboy-bebop");
  });

  it("caps length so a slug always fits a URL segment", () => {
    expect(slugify("a".repeat(200))).toHaveLength(80);
  });

  it("returns an empty string when there is nothing sluggable", () => {
    // `catalogService.uniqueSlug` relies on this to fall back to "show".
    expect(slugify("***")).toBe("");
    expect(slugify("日本語")).toBe("");
  });
});

describe("percentage", () => {
  it("guards a zero total instead of returning NaN", () => {
    expect(percentage(5, 0)).toBe(0);
    expect(percentage(0, 0)).toBe(0);
  });

  it("clamps above 100, which tracked specials would otherwise cause", () => {
    expect(percentage(30, 24)).toBe(100);
  });

  it("computes the ordinary case", () => {
    expect(percentage(6, 24)).toBe(25);
  });
});

describe("clamp / unique / chunk", () => {
  it("clamps to both bounds", () => {
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(-5, 1, 3)).toBe(1);
    expect(clamp(2, 1, 3)).toBe(2);
  });

  it("de-duplicates preserving first-seen order", () => {
    expect(unique([3, 1, 3, 2, 1])).toEqual([3, 1, 2]);
  });

  it("chunks without dropping a short tail", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("pickDeterministic", () => {
  it("returns the same element for the same seed", () => {
    const options = ["a", "b", "c", "d"] as const;
    expect(pickDeterministic(options, "user-123")).toBe(pickDeterministic(options, "user-123"));
  });

  it("always returns an element of the list", () => {
    const options = ["a", "b", "c"] as const;
    for (const seed of ["", "x", "a-much-longer-seed-value", "—"]) {
      expect(options).toContain(pickDeterministic(options, seed));
    }
  });
});
