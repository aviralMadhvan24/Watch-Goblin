import { describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { getRecommendations, getSimilarShows } from "@/server/queries/recommendations";
import { catalogService } from "@/server/services/catalog.service";
import { trackingService } from "@/server/services/tracking.service";

import { createUser, showDetail } from "./factories";

/**
 * Recommendations end to end.
 *
 * The fixtures below give two clearly separated tastes — a mystery/crime
 * cluster and a comedy cluster — because the only way to assert a recommender
 * is working is to build a library whose right answer is obvious, then demand
 * it. Anything vaguer passes whether the scoring is correct or inverted.
 */

async function importShow(
  title: string,
  genres: string[],
  options: { externalId: string; rating?: number; popularity?: number },
) {
  const id = await catalogService.importShow({
    ...showDetail({ title, seasons: [2], externalId: options.externalId }),
    genres,
    externalRating: options.rating ?? 8,
    popularity: options.popularity ?? 50,
  });
  return id;
}

/**
 * Two clusters that share no genre at all, plus filler carrying the catalogue's
 * most common genre so rarity weighting has something to discount.
 */
async function seedWorld() {
  const mystery = [
    await importShow("Detective One", ["Mystery", "Crime"], { externalId: "m1" }),
    await importShow("Detective Two", ["Mystery", "Crime"], { externalId: "m2" }),
    await importShow("Detective Three", ["Mystery", "Crime"], { externalId: "m3" }),
  ];

  const comedy = [
    await importShow("Laugh One", ["Comedy"], { externalId: "c1" }),
    await importShow("Laugh Two", ["Comedy"], { externalId: "c2" }),
    await importShow("Laugh Three", ["Comedy"], { externalId: "c3" }),
  ];

  const filler: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    filler.push(await importShow(`Filler ${i}`, ["Drama"], { externalId: `f${i}` }));
  }

  return { mystery, comedy, filler };
}

describe("getRecommendations", () => {
  it("recommends from the cluster the user rated highly", async () => {
    const world = await seedWorld();
    const user = await createUser();

    // Loves mystery, dislikes comedy — as different as the fixtures allow.
    await trackingService.addToLibrary(user.id, world.mystery[0], { rating: 5 });
    await trackingService.addToLibrary(user.id, world.mystery[1], { rating: 5 });
    await trackingService.addToLibrary(user.id, world.comedy[0], { rating: 1 });

    const recs = await getRecommendations(user.id, 5);
    const titles = recs.map((r) => r.show.title);

    // The unseen mystery show must beat every comedy and filler show.
    expect(titles[0]).toBe("Detective Three");
    expect(titles.slice(0, 3)).not.toContain("Laugh Two");
  });

  it("never recommends something already in the library", async () => {
    const world = await seedWorld();
    const user = await createUser();

    for (const showId of world.mystery) {
      await trackingService.addToLibrary(user.id, showId, { rating: 5 });
    }

    const recs = await getRecommendations(user.id, 20);
    const recommendedIds = new Set(recs.map((r) => r.show.id));

    for (const showId of world.mystery) {
      expect(recommendedIds.has(showId)).toBe(false);
    }
  });

  it("pushes down shows carrying a genre the user dropped", async () => {
    const world = await seedWorld();
    const user = await createUser();

    await trackingService.addToLibrary(user.id, world.mystery[0], { rating: 5 });
    await trackingService.addToLibrary(user.id, world.comedy[0]);
    await trackingService.setStatus(user.id, world.comedy[0], "DROPPED");

    const recs = await getRecommendations(user.id, 10);
    const positions = new Map(recs.map((r, index) => [r.show.title, index]));

    const mysteryRank = positions.get("Detective Two") ?? Infinity;
    const comedyRank = positions.get("Laugh Two") ?? Infinity;

    expect(mysteryRank).toBeLessThan(comedyRank);
  });

  it("explains every recommendation", async () => {
    const world = await seedWorld();
    const user = await createUser();
    await trackingService.addToLibrary(user.id, world.mystery[0], { rating: 5 });

    const recs = await getRecommendations(user.id, 5);

    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) {
      expect(rec.reason.length).toBeGreaterThan(0);
    }
    // Names a show the user actually watched, not a generic phrase.
    expect(recs[0].reason).toContain("Detective One");
  });

  it("falls back to popular shows for an empty library", async () => {
    await seedWorld();
    const user = await createUser();

    const recs = await getRecommendations(user.id, 5);

    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.reason === "Popular right now")).toBe(true);
  });

  it("never recommends a show with no episodes", async () => {
    const world = await seedWorld();
    // A show imported before its season tree existed is not yet trackable.
    await catalogService.importShow({
      ...showDetail({ title: "Announced Only", externalId: "empty" }),
      seasons: [],
      genres: ["Mystery", "Crime"],
    });

    const user = await createUser();
    await trackingService.addToLibrary(user.id, world.mystery[0], { rating: 5 });

    const recs = await getRecommendations(user.id, 20);
    expect(recs.map((r) => r.show.title)).not.toContain("Announced Only");
  });

  it("respects the requested limit", async () => {
    const world = await seedWorld();
    const user = await createUser();
    await trackingService.addToLibrary(user.id, world.mystery[0], { rating: 5 });

    expect(await getRecommendations(user.id, 2)).toHaveLength(2);
  });
});

describe("getSimilarShows", () => {
  it("returns shows sharing the rare genres, not the common one", async () => {
    const world = await seedWorld();
    void world;

    const source = await db.show.findFirstOrThrow({
      where: { title: "Detective One" },
      select: { id: true, type: true },
    });

    const similar = await getSimilarShows(source.id, source.type, 3);
    const titles = similar.map((s) => s.title);

    expect(titles).toContain("Detective Two");
    expect(titles).not.toContain("Filler 0");
  });

  it("never includes the show itself", async () => {
    await seedWorld();

    const source = await db.show.findFirstOrThrow({
      where: { title: "Detective One" },
      select: { id: true, type: true },
    });

    const similar = await getSimilarShows(source.id, source.type, 10);
    expect(similar.map((s) => s.id)).not.toContain(source.id);
  });

  it("stays within the same medium", async () => {
    await seedWorld();
    await catalogService.importShow({
      ...showDetail({ title: "Live Action Detective", type: "TV", externalId: "tv-m" }),
      genres: ["Mystery", "Crime"],
    });

    const source = await db.show.findFirstOrThrow({
      where: { title: "Detective One" },
      select: { id: true, type: true },
    });

    const similar = await getSimilarShows(source.id, source.type, 10);

    // An anime fan looking at an anime does not want a US procedural back,
    // however well the genre tags line up.
    expect(similar.every((s) => s.type === source.type)).toBe(true);
  });

  it("returns nothing for a show with no genres", async () => {
    const id = await catalogService.importShow({
      ...showDetail({ title: "Untagged", externalId: "untagged" }),
      genres: [],
    });

    expect(await getSimilarShows(id, "ANIME", 5)).toEqual([]);
  });
});
