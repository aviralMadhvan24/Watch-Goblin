import { describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { catalogService } from "@/server/services/catalog.service";

import { createShow, createUser, showDetail } from "./factories";

/**
 * Import idempotency is the property the whole catalogue rests on: the bulk
 * importer, the seed and the "user opened a show we have never cached" path all
 * write through `importShow`, and any of them can run over a show that already
 * exists. Getting this wrong duplicates shows or, far worse, renumbers episodes
 * out from under people's watch history.
 */
describe("catalogService.importShow", () => {
  it("upserts on (provider, id) rather than inserting a second copy", async () => {
    const detail = showDetail({ title: "Repeatable", seasons: [3, 2] });

    const first = await catalogService.importShow(detail);
    const second = await catalogService.importShow(detail);

    expect(second).toBe(first);
    expect(await db.show.count()).toBe(1);
    expect(await db.episode.count()).toBe(5);
  });

  it("counts totals from stored rows, not from the provider's claim", async () => {
    // The provider says 99; only 5 episodes actually arrived. Progress
    // percentages divide by this number, so it has to match reality.
    const detail = { ...showDetail({ seasons: [3, 2] }), totalEpisodes: 99, totalSeasons: 9 };
    const showId = await catalogService.importShow(detail);

    const show = await db.show.findUniqueOrThrow({
      where: { id: showId },
      select: { totalEpisodes: true, totalSeasons: true },
    });

    expect(show).toEqual({ totalEpisodes: 5, totalSeasons: 2 });
  });

  it("excludes specials from totals so a show can still reach 100%", async () => {
    const show = await createShow({ seasons: [4], specials: 3 });

    expect(show.totalEpisodes).toBe(4);
    expect(show.totalSeasons).toBe(1);
    // The specials are still imported and still trackable — just not counted.
    expect(show.episodes).toHaveLength(7);
    expect(show.episodes.filter((episode) => episode.seasonNumber === 0)).toHaveLength(3);
  });

  it("keeps episode ids stable across a re-import, so watch history survives", async () => {
    // This is the guarantee that lets the importer refresh a show that people
    // are part-way through. If a re-import replaced episode rows, every
    // `user_episodes` row would be orphaned and everyone's progress would reset.
    const detail = showDetail({ seasons: [3] });
    const showId = await catalogService.importShow(detail);

    const before = await db.episode.findMany({
      where: { showId },
      orderBy: { number: "asc" },
      select: { id: true, number: true },
    });

    const user = await createUser();
    await db.userShow.create({ data: { userId: user.id, showId, status: "WATCHING" } });
    await db.userEpisode.create({
      data: {
        userId: user.id,
        showId,
        episodeId: before[0].id,
        seasonId: (await db.episode.findUniqueOrThrow({ where: { id: before[0].id } })).seasonId,
        seasonNumber: 1,
        episodeNumber: 1,
        watchedOn: new Date("2026-04-01T00:00:00Z"),
      },
    });

    await catalogService.importShow(detail);

    const after = await db.episode.findMany({
      where: { showId },
      orderBy: { number: "asc" },
      select: { id: true, number: true },
    });

    expect(after).toEqual(before);
    expect(await db.userEpisode.count({ where: { userId: user.id } })).toBe(1);
  });

  it("adds newly aired episodes without disturbing the existing ones", async () => {
    const detail = showDetail({ seasons: [2] });
    const showId = await catalogService.importShow(detail);
    const before = await db.episode.findMany({
      where: { showId },
      orderBy: { number: "asc" },
      select: { id: true, number: true },
    });

    const withMore = showDetail({ seasons: [4], externalId: detail.externalId });
    await catalogService.importShow({ ...withMore, title: detail.title });

    const after = await db.episode.findMany({
      where: { showId },
      orderBy: { number: "asc" },
      select: { id: true, number: true },
    });

    expect(after).toHaveLength(4);
    expect(after.slice(0, 2)).toEqual(before);
    expect(
      (await db.show.findUniqueOrThrow({ where: { id: showId }, select: { totalEpisodes: true } }))
        .totalEpisodes,
    ).toBe(4);
  });

  it("writes changed episode metadata back on a refresh", async () => {
    const detail = showDetail({ seasons: [2] });
    const showId = await catalogService.importShow(detail);

    const renamed = structuredClone(detail);
    renamed.seasons[0].episodes[0].title = "A Corrected Title";
    renamed.seasons[0].episodes[0].runtimeMinutes = 47;
    await catalogService.importShow(renamed);

    const episode = await db.episode.findFirstOrThrow({
      where: { showId, seasonNumber: 1, number: 1 },
      select: { title: true, runtimeMinutes: true },
    });

    expect(episode).toEqual({ title: "A Corrected Title", runtimeMinutes: 47 });
  });

  it("keeps the slug stable when the provider renames a show", async () => {
    // Slugs are the public URL. A rename upstream must not break every link
    // that already points at the show.
    const detail = showDetail({ title: "Original Name" });
    const showId = await catalogService.importShow(detail);

    await catalogService.importShow({ ...detail, title: "Renamed Upstream" });

    const show = await db.show.findUniqueOrThrow({
      where: { id: showId },
      select: { slug: true, title: true },
    });

    expect(show.slug).toBe("original-name");
    expect(show.title).toBe("Renamed Upstream");
  });

  it("disambiguates two different shows that share a title", async () => {
    await catalogService.importShow(showDetail({ title: "Same Name", externalId: "a" }));
    await catalogService.importShow(showDetail({ title: "Same Name", externalId: "b" }));

    const slugs = await db.show.findMany({ select: { slug: true }, orderBy: { slug: "asc" } });
    expect(slugs.map((row) => row.slug)).toEqual(["same-name", "same-name-2"]);
  });

  it("does not duplicate shared genres, studios or people across shows", async () => {
    await catalogService.importShow(showDetail({ externalId: "a" }));
    await catalogService.importShow(showDetail({ externalId: "b" }));

    expect(await db.show.count()).toBe(2);
    // Both fixtures name the same genres, studio and cast member.
    expect(await db.genre.count()).toBe(2);
    expect(await db.credit.count()).toBe(1);
    expect(await db.person.count()).toBe(1);
  });
});

describe("catalogService.searchRemote", () => {
  it("hides results the catalogue already holds", async () => {
    const existing = showDetail({ title: "Already Here", externalId: "111" });
    await catalogService.importShow(existing);

    const provider = {
      name: "test",
      async search() {
        return [
          { ...existing },
          { ...showDetail({ title: "Brand New", externalId: "222" }) },
        ];
      },
    };

    const results = await catalogService.searchRemote(provider, "anything");

    expect(results.map((show) => show.title)).toEqual(["Brand New"]);
  });

  it("writes nothing — the import is deferred until a user opens a result", async () => {
    const provider = {
      name: "test",
      async search() {
        return [showDetail({ title: "Not Imported Yet", externalId: "333" })];
      },
    };

    await catalogService.searchRemote(provider, "anything");

    expect(await db.show.count()).toBe(0);
  });
});

describe("catalogService.ensureShowImported", () => {
  it("imports a show the catalogue has never seen", async () => {
    const detail = showDetail({ title: "First Sighting", seasons: [2] });
    const provider = { async getShow() { return detail; } };

    const showId = await catalogService.ensureShowImported(provider, detail.externalId);

    expect(showId).not.toBeNull();
    expect(await db.episode.count({ where: { showId: showId! } })).toBe(2);
  });

  it("returns null when the provider has no such show", async () => {
    const provider = { async getShow() { return null; } };

    expect(await catalogService.ensureShowImported(provider, "nope")).toBeNull();
    expect(await db.show.count()).toBe(0);
  });

  it("commits the whole tree or none of it", async () => {
    // `importShow` runs in one transaction here, so a failure part-way through
    // must not leave a show row with a half-built season tree behind it.
    const detail = showDetail({ seasons: [2] });
    const provider = {
      async getShow() {
        return { ...detail, type: "NOT_A_VALID_TYPE" as never };
      },
    };

    await expect(
      catalogService.ensureShowImported(provider, detail.externalId),
    ).rejects.toThrow();

    expect(await db.show.count()).toBe(0);
    expect(await db.episode.count()).toBe(0);
  });
});
