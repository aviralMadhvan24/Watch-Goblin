import { describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { statsService } from "@/server/services/stats.service";
import { trackingService } from "@/server/services/tracking.service";

import { createShow, createUser } from "./factories";

/**
 * The core write loop.
 *
 * The design these tests defend: `UserEpisode` rows are the only facts, and
 * everything on `UserShow` and `UserStats` is a cache derived from them. So
 * most assertions are made twice — once on what the service reported, once on
 * what the database actually holds — and the final block re-derives the
 * counters from scratch and demands they agree.
 */

async function statsFor(userId: string) {
  return db.userStats.findUniqueOrThrow({
    where: { userId },
    select: {
      episodesWatched: true,
      minutesWatched: true,
      showsCompleted: true,
      animeCompleted: true,
      seasonsCompleted: true,
      watching: true,
      planToWatch: true,
      xpTotal: true,
      level: true,
    },
  });
}

describe("marking episodes", () => {
  it("adds the show to the library on the first episode", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [3] });

    const outcome = await trackingService.markEpisodeWatched(user.id, show.episodes[0].id);

    expect(outcome.status).toBe("WATCHING");
    expect(outcome.episodesWatched).toBe(1);
    expect(outcome.totalEpisodes).toBe(3);
    expect(outcome.currentSeasonNumber).toBe(1);
    expect(outcome.currentEpisodeNumber).toBe(1);

    const userShow = await db.userShow.findUniqueOrThrow({
      where: { userId_showId: { userId: user.id, showId: show.id } },
      select: { status: true, episodesWatched: true, startedAt: true, completedAt: true },
    });
    expect(userShow.status).toBe("WATCHING");
    expect(userShow.episodesWatched).toBe(1);
    expect(userShow.startedAt).not.toBeNull();
    expect(userShow.completedAt).toBeNull();
  });

  it("counts the show as a member exactly once", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [3] });

    await trackingService.markEpisodeWatched(user.id, show.episodes[0].id);
    await trackingService.markEpisodeWatched(user.id, show.episodes[1].id);

    const row = await db.show.findUniqueOrThrow({
      where: { id: show.id },
      select: { memberCount: true },
    });
    expect(row.memberCount).toBe(1);
  });

  it("is idempotent: re-marking the same episode changes nothing", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [3] });

    await trackingService.markEpisodeWatched(user.id, show.episodes[0].id);
    const before = await statsFor(user.id);

    const second = await trackingService.markEpisodeWatched(user.id, show.episodes[0].id);

    expect(second.episodesWatched).toBe(1);
    expect(await db.userEpisode.count({ where: { userId: user.id } })).toBe(1);
    expect(await statsFor(user.id)).toEqual(before);
  });

  it("completes the show on the last episode", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [2, 2] });

    let outcome = await trackingService.markEpisodeWatched(user.id, show.episodes[0].id);
    for (const episode of show.episodes.slice(1)) {
      outcome = await trackingService.markEpisodeWatched(user.id, episode.id);
    }

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.showCompleted).toBe(true);
    expect(outcome.progress).toBe(1);

    const userShow = await db.userShow.findUniqueOrThrow({
      where: { userId_showId: { userId: user.id, showId: show.id } },
      select: { status: true, completedAt: true, seasonsCompleted: true },
    });
    expect(userShow.status).toBe("COMPLETED");
    expect(userShow.completedAt).not.toBeNull();
    expect(userShow.seasonsCompleted).toBe(2);
  });

  it("uses each episode's own runtime for minutes watched", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [2], runtimeMinutes: 42 });

    await trackingService.markEpisodeWatched(user.id, show.episodes[0].id);
    const outcome = await trackingService.markEpisodeWatched(user.id, show.episodes[1].id);

    void outcome;
    const userShow = await db.userShow.findUniqueOrThrow({
      where: { userId_showId: { userId: user.id, showId: show.id } },
      select: { minutesWatched: true },
    });
    expect(userShow.minutesWatched).toBe(84);
  });

  it("rejects an episode that does not exist", async () => {
    const user = await createUser();

    await expect(trackingService.markEpisodeWatched(user.id, "no-such-episode")).rejects.toThrow();
  });
});

describe("specials", () => {
  it("tracks specials without letting them push progress past 100%", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [2], specials: 3 });

    for (const episode of show.episodes) {
      await trackingService.markEpisodeWatched(user.id, episode.id);
    }

    const outcome = await trackingService.markEpisodeWatched(user.id, show.episodes[0].id);

    // Five episodes exist; only the two regular ones count toward completion.
    expect(await db.userEpisode.count({ where: { userId: user.id } })).toBe(5);
    expect(outcome.episodesWatched).toBe(2);
    expect(outcome.progress).toBe(1);
    expect(outcome.status).toBe("COMPLETED");
  });
});

describe("undo", () => {
  it("drops a completed show back to WATCHING", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [2] });

    for (const episode of show.episodes) {
      await trackingService.markEpisodeWatched(user.id, episode.id);
    }

    const outcome = await trackingService.unmarkEpisodeWatched(user.id, show.episodes[1].id);

    expect(outcome.status).toBe("WATCHING");
    expect(outcome.episodesWatched).toBe(1);

    const userShow = await db.userShow.findUniqueOrThrow({
      where: { userId_showId: { userId: user.id, showId: show.id } },
      select: { status: true, completedAt: true, episodesWatched: true },
    });
    expect(userShow.status).toBe("WATCHING");
    expect(userShow.completedAt).toBeNull();
    expect(userShow.episodesWatched).toBe(1);
  });

  it("returns an untouched show to PLAN_TO_WATCH", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [3] });

    await trackingService.markEpisodeWatched(user.id, show.episodes[0].id);
    const outcome = await trackingService.unmarkEpisodeWatched(user.id, show.episodes[0].id);

    expect(outcome.status).toBe("PLAN_TO_WATCH");
    expect(outcome.episodesWatched).toBe(0);
  });

  it("refuses to unmark something that was never marked", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [3] });

    await expect(
      trackingService.unmarkEpisodeWatched(user.id, show.episodes[0].id),
    ).rejects.toThrow();
  });
});

describe("XP and the anti-farming ledger", () => {
  it("awards XP for a newly watched episode", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [3] });

    const outcome = await trackingService.markEpisodeWatched(user.id, show.episodes[0].id);

    expect(outcome.xpAwarded).toBeGreaterThan(0);
    // `xpAwarded` covers episode/season/show awards only. The daily-streak
    // bonus is granted inside `streakService` and reported via `outcome.streak`,
    // so the ledger total is the larger number.
    expect((await statsFor(user.id)).xpTotal).toBeGreaterThanOrEqual(outcome.xpAwarded);
  });

  it("never pays twice for the same episode, however many times it is toggled", async () => {
    // This is the whole point of the stable dedupe key: unwatch/rewatch must
    // not be a way to farm XP.
    const user = await createUser();
    const show = await createShow({ seasons: [3] });

    await trackingService.markEpisodeWatched(user.id, show.episodes[0].id);
    const afterFirst = (await statsFor(user.id)).xpTotal;

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await trackingService.unmarkEpisodeWatched(user.id, show.episodes[0].id);
      const remark = await trackingService.markEpisodeWatched(user.id, show.episodes[0].id);
      expect(remark.xpAwarded).toBe(0);
    }

    expect((await statsFor(user.id)).xpTotal).toBe(afterFirst);
    expect(await db.xpEvent.count({ where: { userId: user.id } })).toBeGreaterThan(0);
  });

  it("does not revoke XP when a fact is undone", async () => {
    // XP is a record of things you did, not a live counter.
    const user = await createUser();
    const show = await createShow({ seasons: [3] });

    await trackingService.markEpisodeWatched(user.id, show.episodes[0].id);
    const earned = (await statsFor(user.id)).xpTotal;

    await trackingService.unmarkEpisodeWatched(user.id, show.episodes[0].id);

    expect((await statsFor(user.id)).xpTotal).toBe(earned);
  });

  it("keeps the ledger free of duplicate keys", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [2, 2] });

    for (const episode of show.episodes) {
      await trackingService.markEpisodeWatched(user.id, episode.id);
    }

    const events = await db.xpEvent.findMany({
      where: { userId: user.id },
      select: { dedupeKey: true, amount: true },
    });

    expect(new Set(events.map((event) => event.dedupeKey)).size).toBe(events.length);
    expect(events.reduce((sum, event) => sum + event.amount, 0)).toBe(
      (await statsFor(user.id)).xpTotal,
    );
  });
});

describe("bulk marking", () => {
  it("marks a whole season at once", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [3, 4] });
    const seasonOne = show.episodes.find((episode) => episode.seasonNumber === 1)!;

    const outcome = await trackingService.markSeasonWatched(user.id, seasonOne.seasonId);

    expect(outcome.episodesWatched).toBe(3);
    expect(outcome.status).toBe("WATCHING");
    expect(await db.userEpisode.count({ where: { userId: user.id } })).toBe(3);
  });

  it("re-marking a season adds nothing and pays nothing", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [3] });
    const seasonOne = show.episodes[0];

    await trackingService.markSeasonWatched(user.id, seasonOne.seasonId);
    const before = await statsFor(user.id);

    const second = await trackingService.markSeasonWatched(user.id, seasonOne.seasonId);

    expect(second.xpAwarded).toBe(0);
    expect(await statsFor(user.id)).toEqual(before);
  });

  it("marks everything up to a position, across seasons", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [3, 4] });

    const outcome = await trackingService.markWatchedUpTo(user.id, show.id, 2, 2);

    // All of season 1, plus S2E1 and S2E2.
    expect(outcome.episodesWatched).toBe(5);
    expect(outcome.currentSeasonNumber).toBe(2);
    expect(outcome.currentEpisodeNumber).toBe(2);

    const watched = await db.userEpisode.findMany({
      where: { userId: user.id },
      orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
      select: { seasonNumber: true, episodeNumber: true },
    });
    expect(watched).toEqual([
      { seasonNumber: 1, episodeNumber: 1 },
      { seasonNumber: 1, episodeNumber: 2 },
      { seasonNumber: 1, episodeNumber: 3 },
      { seasonNumber: 2, episodeNumber: 1 },
      { seasonNumber: 2, episodeNumber: 2 },
    ]);
  });

  it("continues from wherever the user left off", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [3] });

    await trackingService.markEpisodeWatched(user.id, show.episodes[0].id);
    const outcome = await trackingService.continueWatching(user.id, show.id);

    expect(outcome?.currentEpisodeNumber).toBe(2);
    expect(outcome?.episodesWatched).toBe(2);
  });

  it("reports nothing left to continue once a show is finished", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [2] });

    for (const episode of show.episodes) {
      await trackingService.markEpisodeWatched(user.id, episode.id);
    }

    expect(await trackingService.continueWatching(user.id, show.id)).toBeNull();
  });
});

describe("library membership", () => {
  it("removing a show erases its episodes and its counters", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [3] });

    for (const episode of show.episodes) {
      await trackingService.markEpisodeWatched(user.id, episode.id);
    }

    await trackingService.removeFromLibrary(user.id, show.id);

    expect(await db.userShow.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.userEpisode.count({ where: { userId: user.id } })).toBe(0);

    const stats = await statsFor(user.id);
    expect(stats.episodesWatched).toBe(0);
    expect(stats.showsCompleted).toBe(0);
    // The ledger survives: XP is never revoked.
    expect(stats.xpTotal).toBeGreaterThan(0);
  });

  it("rejects an out-of-range rating", async () => {
    const user = await createUser();
    const show = await createShow({ seasons: [1] });
    await trackingService.addToLibrary(user.id, show.id);

    await expect(trackingService.rate(user.id, show.id, 4.3)).rejects.toThrow();
    await expect(trackingService.rate(user.id, show.id, 6)).rejects.toThrow();
    await expect(trackingService.rate(user.id, show.id, 4.5)).resolves.toBeUndefined();
  });

  it("maintains the show's rating average as a sum/count pair", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const show = await createShow({ seasons: [1] });

    await trackingService.addToLibrary(a.id, show.id);
    await trackingService.addToLibrary(b.id, show.id);
    await trackingService.rate(a.id, show.id, 4);
    await trackingService.rate(b.id, show.id, 5);

    const row = await db.show.findUniqueOrThrow({
      where: { id: show.id },
      select: { ratingSum: true, ratingCount: true },
    });
    expect(row.ratingCount).toBe(2);
    expect(row.ratingSum).toBe(9);
  });
});

/**
 * The oracle. `statsService.recompute` derives every counter from the facts
 * still in the database, so running it must be a no-op after any sequence of
 * incremental updates. If these ever disagree, the incremental path has a bug
 * — which is precisely the failure mode denormalised counters are prone to.
 */
describe("incremental counters agree with a full recompute", () => {
  it("after a mixed sequence of marks, undos, completions and removals", async () => {
    const user = await createUser();
    const anime = await createShow({ seasons: [2, 2], type: "ANIME" });
    const tv = await createShow({ seasons: [3], type: "TV", runtimeMinutes: 45 });
    const dropped = await createShow({ seasons: [4], type: "TV" });

    for (const episode of anime.episodes) {
      await trackingService.markEpisodeWatched(user.id, episode.id);
    }
    await trackingService.markWatchedUpTo(user.id, tv.id, 1, 2);
    await trackingService.markEpisodeWatched(user.id, dropped.episodes[0].id);
    await trackingService.setStatus(user.id, dropped.id, "DROPPED");
    await trackingService.unmarkEpisodeWatched(user.id, tv.episodes[1].id);

    const incremental = await statsFor(user.id);
    await statsService.recompute(user.id);
    const authoritative = await statsFor(user.id);

    expect(incremental).toEqual(authoritative);
    expect(authoritative.showsCompleted).toBe(1);
    expect(authoritative.animeCompleted).toBe(1);
    expect(authoritative.episodesWatched).toBe(6);
  });

  it("after a show is removed from the library entirely", async () => {
    const user = await createUser();
    const keep = await createShow({ seasons: [2] });
    const remove = await createShow({ seasons: [2] });

    for (const episode of [...keep.episodes, ...remove.episodes]) {
      await trackingService.markEpisodeWatched(user.id, episode.id);
    }
    await trackingService.removeFromLibrary(user.id, remove.id);

    const incremental = await statsFor(user.id);
    await statsService.recompute(user.id);

    expect(incremental).toEqual(await statsFor(user.id));
  });
});
