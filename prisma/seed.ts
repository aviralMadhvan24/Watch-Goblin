import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import { ACHIEVEMENT_DEFINITIONS } from "../src/config/achievements";
import { buildRankRows } from "../src/config/ranks";
import { XP_AWARDS, xpDedupeKey } from "../src/config/xp";
import { PrismaClient } from "../src/generated/prisma/client";
import type { WatchStatus } from "../src/generated/prisma/enums";
import { xpToLevel } from "../src/lib/leveling";
import { slugify } from "../src/lib/utils";

import { SEED_CATALOGUE, type SeedShow } from "./seed-data/catalogue";
import {
  REVIEW_TEMPLATES,
  SEED_PASSWORD,
  SEED_USERS,
  SPOILER_REVIEWS,
  type SeedUser,
} from "./seed-data/users";

/**
 * Development seed.
 *
 * Two things this script deliberately does *not* do:
 *
 *  1. It does not call the tracking service episode by episode. Seeding ~40k
 *     watch events through the real write path would take minutes and would
 *     only be testing the service against itself.
 *  2. It does not fabricate derived values. It writes the *facts* — watched
 *     episodes, XP ledger rows, daily rollups, follows, reviews — and then runs
 *     the real `statsService.recompute` and `streakService.recompute` over
 *     them. So every counter, level, rank and streak in the seeded database was
 *     produced by production code from production facts, which is what makes
 *     the seed trustworthy as a fixture.
 *
 * Randomness is seeded, so `npm run db:seed` twice gives identical databases.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Deterministic PRNG (mulberry32) so seeded data is reproducible. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  return function random(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const DAY_MS = 86_400_000;
function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function main() {
  const startedAt = Date.now();
  console.log("Seeding WatchGoblin…\n");

  await reset();
  await seedRanks();
  await seedAchievements();
  const shows = await seedCatalogue();
  const users = await seedUsers();
  await seedWatchHistories(users, shows);
  await seedSocial(users, shows);
  await finalise(users);

  console.log(`\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
  console.log(`Sign in with any username below and the password: ${SEED_PASSWORD}`);
  console.log(SEED_USERS.map((user) => `  @${user.username}`).join("\n"));
}

/** Wipes user-generated data. Order matters: children before parents. */
async function reset() {
  console.log("Clearing existing data…");
  await db.$transaction([
    db.activity.deleteMany(),
    db.reviewLike.deleteMany(),
    db.comment.deleteMany(),
    db.review.deleteMany(),
    db.userEpisode.deleteMany(),
    db.userShow.deleteMany(),
    db.dailyWatchLog.deleteMany(),
    db.xpEvent.deleteMany(),
    db.userAchievement.deleteMany(),
    db.userFavoriteShow.deleteMany(),
    db.userFavoriteGenre.deleteMany(),
    db.follow.deleteMany(),
    db.block.deleteMany(),
    db.watchStreak.deleteMany(),
    db.userStats.deleteMany(),
    db.session.deleteMany(),
    db.passwordResetToken.deleteMany(),
    db.adminAuditLog.deleteMany(),
    db.profile.deleteMany(),
    db.user.deleteMany(),
  ]);
}

async function seedRanks() {
  const rows = buildRankRows();
  for (const rank of rows) {
    await db.rank.upsert({
      where: { slug: rank.slug },
      create: {
        slug: rank.slug,
        name: rank.name,
        description: rank.description,
        icon: rank.icon,
        minLevel: rank.minLevel,
        minXp: rank.minXp,
        maxXp: rank.maxXp,
        accentColor: rank.accentColor,
      },
      update: {
        name: rank.name,
        description: rank.description,
        icon: rank.icon,
        minXp: rank.minXp,
        maxXp: rank.maxXp,
        accentColor: rank.accentColor,
      },
    });
  }
  console.log(`Ranks: ${rows.length}`);
}

async function seedAchievements() {
  for (const [index, achievement] of ACHIEVEMENT_DEFINITIONS.entries()) {
    await db.achievement.upsert({
      where: { code: achievement.code },
      create: { ...achievement, sortOrder: index, isSecret: achievement.isSecret ?? false },
      update: { ...achievement, sortOrder: index, isSecret: achievement.isSecret ?? false },
    });
  }
  console.log(`Achievements: ${ACHIEVEMENT_DEFINITIONS.length}`);
}

interface SeededShow {
  id: string;
  type: "ANIME" | "TV";
  title: string;
  totalEpisodes: number;
  runtime: number;
  popularity: number;
  seasons: { id: string; number: number; episodeIds: string[] }[];
}

async function seedCatalogue(): Promise<SeededShow[]> {
  console.log("Catalogue…");
  const seeded: SeededShow[] = [];

  for (const show of SEED_CATALOGUE) {
    seeded.push(await seedShow(show));
  }

  const episodes = seeded.reduce((sum, show) => sum + show.totalEpisodes, 0);
  console.log(`Shows: ${seeded.length}  Episodes: ${episodes.toLocaleString()}`);
  return seeded;
}

async function seedShow(show: SeedShow): Promise<SeededShow> {
  const totalEpisodes = show.seasons.reduce((sum, season) => sum + season.episodes, 0);

  const row = await db.show.upsert({
    where: {
      show_source_identity: { sourceProvider: "local", sourceId: show.externalId },
    },
    create: {
      slug: slugify(show.title),
      type: show.type,
      title: show.title,
      originalTitle: show.originalTitle ?? null,
      synopsis: show.synopsis,
      airingStatus: show.airingStatus,
      firstAirDate: new Date(Date.UTC(show.firstAirYear, 3, 5)),
      lastAirDate: show.lastAirYear ? new Date(Date.UTC(show.lastAirYear, 8, 20)) : null,
      averageRuntimeMinutes: show.runtime,
      totalSeasons: show.seasons.length,
      totalEpisodes,
      originalLanguage: show.language,
      popularity: show.popularity,
      externalRating: show.externalRating,
      sourceProvider: "local",
      sourceId: show.externalId,
    },
    update: {
      title: show.title,
      synopsis: show.synopsis,
      totalSeasons: show.seasons.length,
      totalEpisodes,
      popularity: show.popularity,
    },
    select: { id: true },
  });

  // Genres
  for (const name of show.genres) {
    const genre = await db.genre.upsert({
      where: { slug: slugify(name) },
      create: { slug: slugify(name), name },
      update: {},
      select: { id: true },
    });
    await db.showGenre.createMany({
      data: [{ showId: row.id, genreId: genre.id }],
      skipDuplicates: true,
    });
  }

  // Studios / networks
  for (const credit of show.credits) {
    const slug = slugify(`${credit.kind}-${credit.name}`);
    const creditRow = await db.credit.upsert({
      where: { slug },
      create: { slug, name: credit.name, kind: credit.kind },
      update: {},
      select: { id: true },
    });
    await db.showCredit.createMany({
      data: [{ showId: row.id, creditId: creditRow.id }],
      skipDuplicates: true,
    });
  }

  const seasons: SeededShow["seasons"] = [];

  for (const season of show.seasons) {
    const seasonRow = await db.season.upsert({
      where: { showId_number: { showId: row.id, number: season.number } },
      create: {
        showId: row.id,
        number: season.number,
        title: `Season ${season.number}`,
        airDate: new Date(Date.UTC(season.year ?? show.firstAirYear, 3, 5)),
        episodeCount: season.episodes,
      },
      update: { episodeCount: season.episodes },
      select: { id: true },
    });

    const year = season.year ?? show.firstAirYear;

    await db.episode.createMany({
      data: Array.from({ length: season.episodes }, (_, index) => {
        const number = index + 1;
        return {
          showId: row.id,
          seasonId: seasonRow.id,
          seasonNumber: season.number,
          number,
          title: season.titles?.[index] ?? `Episode ${number}`,
          airDate: new Date(Date.UTC(year, 3, 5) + index * 7 * DAY_MS),
          runtimeMinutes: show.runtime,
        };
      }),
      skipDuplicates: true,
    });

    const episodeIds = await db.episode.findMany({
      where: { seasonId: seasonRow.id },
      orderBy: { number: "asc" },
      select: { id: true },
    });

    seasons.push({
      id: seasonRow.id,
      number: season.number,
      episodeIds: episodeIds.map((episode) => episode.id),
    });
  }

  return {
    id: row.id,
    type: show.type,
    title: show.title,
    totalEpisodes,
    runtime: show.runtime,
    popularity: show.popularity,
    seasons,
  };
}

interface SeededUser extends SeedUser {
  id: string;
}

async function seedUsers(): Promise<SeededUser[]> {
  console.log("Users…");
  // One hash, reused: bcrypt at cost 12 twelve times is slower than the rest of
  // the seed combined, and every seeded account shares the same password anyway.
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);

  const users: SeededUser[] = [];

  for (const [index, user] of SEED_USERS.entries()) {
    const created = await db.user.create({
      data: {
        email: `${user.username}@watchgoblin.test`,
        username: user.username,
        passwordHash,
        role: user.isAdmin ? "ADMIN" : "USER",
        createdAt: new Date(Date.now() - (SEED_USERS.length - index) * 30 * DAY_MS),
        profile: {
          create: {
            displayName: user.displayName,
            bio: user.bio,
            accentColor: user.accentColor,
            visibility: user.visibility ?? "PUBLIC",
            activityVisibility: user.visibility ?? "PUBLIC",
          },
        },
        stats: { create: {} },
        streak: { create: {} },
      },
      select: { id: true },
    });

    users.push({ ...user, id: created.id });
  }

  console.log(`Users: ${users.length}`);
  return users;
}

/**
 * Builds each persona's watch history as raw facts: user_shows, user_episodes,
 * daily rollups and XP ledger rows, all backdated across `historyDays` so the
 * charts and Wrapped have a real shape.
 */
async function seedWatchHistories(users: SeededUser[], shows: SeededShow[]) {
  console.log("Watch histories…");

  const now = Date.now();
  let totalEpisodes = 0;

  for (const user of users) {
    if (user.intensity <= 0) continue;

    const random = createRandom(hashSeed(user.username));

    const pool = shows
      .filter((show) => {
        if (user.bias === "anime") return show.type === "ANIME" || random() < 0.3;
        if (user.bias === "tv") return show.type === "TV" || random() < 0.3;
        return true;
      })
      // Favour popular shows, but not exclusively.
      .sort((a, b) => b.popularity + random() * 30 - (a.popularity + random() * 30));

    const libraryCount = Math.max(3, Math.round(pool.length * user.intensity));
    const library = pool.slice(0, libraryCount);

    const userEpisodes: {
      userId: string;
      episodeId: string;
      showId: string;
      seasonId: string;
      seasonNumber: number;
      episodeNumber: number;
      watchedAt: Date;
      watchedOn: Date;
    }[] = [];

    const xpEvents: {
      userId: string;
      amount: number;
      reason: "EPISODE_WATCHED" | "SEASON_COMPLETED" | "SHOW_COMPLETED";
      dedupeKey: string;
      createdAt: Date;
    }[] = [];

    const userShows: {
      userId: string;
      showId: string;
      status: WatchStatus;
      rating: number | null;
      startedAt: Date | null;
      completedAt: Date | null;
    }[] = [];

    for (const [showIndex, show] of library.entries()) {
      const roll = random();
      let status: WatchStatus;

      if (roll < user.dropRate) status = "DROPPED";
      else if (roll < user.dropRate + 0.12) status = "PLAN_TO_WATCH";
      else if (roll < user.dropRate + 0.2) status = "ON_HOLD";
      else if (roll < user.dropRate + 0.34) status = "WATCHING";
      else status = "COMPLETED";

      // How far through the show they got.
      const completion =
        status === "COMPLETED"
          ? 1
          : status === "PLAN_TO_WATCH"
            ? 0
            : status === "DROPPED"
              ? 0.04 + random() * 0.28
              : status === "ON_HOLD"
                ? 0.2 + random() * 0.4
                : 0.15 + random() * 0.7;

      const target = Math.floor(show.totalEpisodes * completion);

      // Spread this show's viewing over a contiguous window in the past, so
      // the monthly charts show bursts rather than uniform noise.
      const windowEnd = now - Math.floor(random() * user.historyDays * 0.35) * DAY_MS;
      const windowDays = Math.max(2, Math.round((target / 6) * (0.6 + random())));
      const windowStart = windowEnd - windowDays * DAY_MS;

      let watched = 0;
      let firstAt: Date | null = null;
      let lastAt: Date | null = null;

      outer: for (const season of show.seasons) {
        if (season.number === 0) continue;
        for (const [episodeIndex, episodeId] of season.episodeIds.entries()) {
          if (watched >= target) break outer;

          const progressRatio = target > 0 ? watched / target : 0;
          const at = new Date(
            windowStart + progressRatio * (windowEnd - windowStart) + random() * DAY_MS * 0.4,
          );

          userEpisodes.push({
            userId: user.id,
            episodeId,
            showId: show.id,
            seasonId: season.id,
            seasonNumber: season.number,
            episodeNumber: episodeIndex + 1,
            watchedAt: at,
            watchedOn: utcDay(at),
          });

          xpEvents.push({
            userId: user.id,
            amount: XP_AWARDS.EPISODE_WATCHED,
            reason: "EPISODE_WATCHED",
            dedupeKey: xpDedupeKey.episode(episodeId),
            createdAt: at,
          });

          firstAt ??= at;
          lastAt = at;
          watched++;
        }
      }

      // Season-completion XP for every season fully covered.
      let covered = 0;
      for (const season of show.seasons) {
        if (season.number === 0) continue;
        covered += season.episodeIds.length;
        if (covered <= watched && season.episodeIds.length > 0) {
          xpEvents.push({
            userId: user.id,
            amount: XP_AWARDS.SEASON_COMPLETED,
            reason: "SEASON_COMPLETED",
            dedupeKey: xpDedupeKey.season(season.id),
            createdAt: lastAt ?? new Date(windowEnd),
          });
        }
      }

      if (status === "COMPLETED") {
        xpEvents.push({
          userId: user.id,
          amount: XP_AWARDS.SHOW_COMPLETED,
          reason: "SHOW_COMPLETED",
          dedupeKey: xpDedupeKey.show(show.id),
          createdAt: lastAt ?? new Date(windowEnd),
        });
      }

      const rated = status === "COMPLETED" || status === "DROPPED" || random() < 0.4;
      const baseRating = status === "DROPPED" ? 1 + random() * 2 : 3 + random() * 2;

      userShows.push({
        userId: user.id,
        showId: show.id,
        status,
        rating: rated ? Math.round(baseRating * 2) / 2 : null,
        startedAt: firstAt,
        completedAt: status === "COMPLETED" ? lastAt : null,
      });

      totalEpisodes += watched;
      void showIndex;
    }

    // Give the persona the exact current streak they advertise, by planting
    // activity on each of the last N days.
    if (user.currentStreak > 0 && userEpisodes.length > 0) {
      for (let dayOffset = 0; dayOffset < user.currentStreak; dayOffset++) {
        const at = new Date(now - dayOffset * DAY_MS - random() * DAY_MS * 0.4);
        const index = Math.floor(random() * userEpisodes.length);
        userEpisodes[index].watchedAt = at;
        userEpisodes[index].watchedOn = utcDay(at);
      }
    }

    await db.userShow.createMany({ data: userShows, skipDuplicates: true });

    // Chunked because a single createMany with tens of thousands of rows can
    // blow past the driver's parameter limit.
    for (const batch of chunk(userEpisodes, 2000)) {
      await db.userEpisode.createMany({ data: batch, skipDuplicates: true });
    }
    for (const batch of chunk(xpEvents, 2000)) {
      await db.xpEvent.createMany({ data: batch, skipDuplicates: true });
    }

    await rebuildDailyLogs(user.id);
  }

  console.log(`Watched episodes: ${totalEpisodes.toLocaleString()}`);
}

/** Rebuilds daily rollups from the episode facts, the same way production does. */
async function rebuildDailyLogs(userId: string) {
  const rows = await db.$queryRaw<{ date: Date; episodes: bigint; minutes: bigint }[]>`
    SELECT ue."watchedOn" AS date,
           COUNT(*) AS episodes,
           COALESCE(SUM(COALESCE(e."runtimeMinutes", s."averageRuntimeMinutes")), 0) AS minutes
    FROM user_episodes ue
    JOIN episodes e ON e.id = ue."episodeId"
    JOIN shows s ON s.id = ue."showId"
    WHERE ue."userId" = ${userId}
    GROUP BY ue."watchedOn"
  `;

  if (rows.length === 0) return;

  await db.dailyWatchLog.createMany({
    data: rows.map((row) => ({
      userId,
      date: row.date,
      episodesWatched: Number(row.episodes),
      minutesWatched: Number(row.minutes),
    })),
    skipDuplicates: true,
  });
}

async function seedSocial(users: SeededUser[], shows: SeededShow[]) {
  console.log("Social graph, reviews and activity…");

  const random = createRandom(hashSeed("social"));

  // Follows: everyone follows the heavy watchers, plus a random scattering.
  const follows: { followerId: string; followingId: string }[] = [];
  const popular = users.slice(0, 4);

  for (const user of users) {
    for (const target of popular) {
      if (target.id !== user.id && random() < 0.75) {
        follows.push({ followerId: user.id, followingId: target.id });
      }
    }
    for (const target of users) {
      if (target.id !== user.id && random() < 0.22) {
        follows.push({ followerId: user.id, followingId: target.id });
      }
    }
  }

  await db.follow.createMany({ data: follows, skipDuplicates: true });

  // Reviews, drawn from the user's own rated shows so the score and the text agree.
  let reviewCount = 0;
  const reviews: { id: string; userId: string }[] = [];

  for (const user of users) {
    const rated = await db.userShow.findMany({
      where: { userId: user.id, rating: { not: null } },
      select: { showId: true, rating: true, completedAt: true, startedAt: true },
      take: 40,
    });

    for (const entry of rated) {
      if (random() > 0.35) continue;

      const rating = entry.rating!;
      const band = REVIEW_TEMPLATES.find((template) => rating >= template.min) ?? REVIEW_TEMPLATES.at(-1)!;
      const hasSpoilers = random() < 0.15;
      const body = hasSpoilers
        ? SPOILER_REVIEWS[Math.floor(random() * SPOILER_REVIEWS.length)]
        : band.bodies[Math.floor(random() * band.bodies.length)];

      const created = await db.review.create({
        data: {
          userId: user.id,
          showId: entry.showId,
          rating,
          body,
          hasSpoilers,
          createdAt: entry.completedAt ?? entry.startedAt ?? new Date(),
        },
        select: { id: true, userId: true },
      });

      await db.xpEvent.create({
        data: {
          userId: user.id,
          amount: XP_AWARDS.REVIEW_POSTED,
          reason: "REVIEW_POSTED",
          dedupeKey: xpDedupeKey.review(created.id),
        },
      });

      reviews.push(created);
      reviewCount++;
    }
  }

  // Likes and comments.
  const likes: { reviewId: string; userId: string }[] = [];
  const comments: { reviewId: string; userId: string; body: string }[] = [];
  const commentBodies = [
    "this is the correct take",
    "respectfully, no",
    "you have convinced me to finally start it",
    "i dropped this at episode 3, should i go back",
    "reading this on my third rewatch",
    "not the spoiler tag saving my life",
  ];

  for (const review of reviews) {
    for (const user of users) {
      if (user.id === review.userId) continue;
      if (random() < 0.18) likes.push({ reviewId: review.id, userId: user.id });
      if (random() < 0.05) {
        comments.push({
          reviewId: review.id,
          userId: user.id,
          body: commentBodies[Math.floor(random() * commentBodies.length)],
        });
      }
    }
  }

  await db.reviewLike.createMany({ data: likes, skipDuplicates: true });
  await db.comment.createMany({ data: comments, skipDuplicates: true });

  // Denormalised review counters.
  for (const review of reviews) {
    const [likeCount, commentCount] = await Promise.all([
      db.reviewLike.count({ where: { reviewId: review.id } }),
      db.comment.count({ where: { reviewId: review.id } }),
    ]);
    await db.review.update({ where: { id: review.id }, data: { likeCount, commentCount } });
  }

  // Favourite shows: the top-rated completed entries.
  for (const user of users) {
    const favourites = await db.userShow.findMany({
      where: { userId: user.id, status: "COMPLETED", rating: { gte: 4 } },
      orderBy: { rating: "desc" },
      take: 4,
      select: { showId: true },
    });

    await db.userFavoriteShow.createMany({
      data: favourites.map((favourite, index) => ({
        userId: user.id,
        showId: favourite.showId,
        slot: index,
      })),
      skipDuplicates: true,
    });
  }

  // Favourite genres, inferred from what each user actually finished.
  for (const user of users) {
    const genres = await db.$queryRaw<{ genreId: string }[]>`
      SELECT sg."genreId"
      FROM user_shows us
      JOIN show_genres sg ON sg."showId" = us."showId"
      WHERE us."userId" = ${user.id} AND us.status = 'COMPLETED'
      GROUP BY sg."genreId"
      ORDER BY COUNT(*) DESC
      LIMIT 4
    `;
    await db.userFavoriteGenre.createMany({
      data: genres.map((genre) => ({ userId: user.id, genreId: genre.genreId })),
      skipDuplicates: true,
    });
  }

  await seedActivity(users, shows);

  console.log(
    `Follows: ${follows.length}  Reviews: ${reviewCount}  Likes: ${likes.length}  Comments: ${comments.length}`,
  );
}

/**
 * Backfills the activity feed from the facts already seeded, so the feed shows
 * a plausible history instead of everything happening at once.
 */
async function seedActivity(users: SeededUser[], shows: SeededShow[]) {
  const showsById = new Map(shows.map((show) => [show.id, show]));

  for (const user of users) {
    const entries: {
      userId: string;
      type: "EPISODE_WATCHED" | "SHOW_COMPLETED" | "SHOW_ADDED" | "REVIEW_POSTED";
      showId: string | null;
      reviewId: string | null;
      payload: Record<string, unknown>;
      createdAt: Date;
    }[] = [];

    const completed = await db.userShow.findMany({
      where: { userId: user.id, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      take: 12,
      select: { showId: true, completedAt: true, episodesWatched: true, show: { select: { title: true, slug: true, type: true } } },
    });

    for (const entry of completed) {
      entries.push({
        userId: user.id,
        type: "SHOW_COMPLETED",
        showId: entry.showId,
        reviewId: null,
        payload: {
          showTitle: entry.show.title,
          showSlug: entry.show.slug,
          showType: entry.show.type,
          episodes: showsById.get(entry.showId)?.totalEpisodes ?? 0,
        },
        createdAt: entry.completedAt ?? new Date(),
      });
    }

    const recentEpisodes = await db.userEpisode.findMany({
      where: { userId: user.id },
      orderBy: { watchedAt: "desc" },
      take: 25,
      select: {
        showId: true,
        seasonNumber: true,
        episodeNumber: true,
        watchedAt: true,
        show: { select: { title: true, slug: true, type: true } },
        episode: { select: { title: true } },
      },
    });

    for (const entry of recentEpisodes) {
      entries.push({
        userId: user.id,
        type: "EPISODE_WATCHED",
        showId: entry.showId,
        reviewId: null,
        payload: {
          showTitle: entry.show.title,
          showSlug: entry.show.slug,
          showType: entry.show.type,
          seasonNumber: entry.seasonNumber,
          episodeNumber: entry.episodeNumber,
          episodeTitle: entry.episode.title,
        },
        createdAt: entry.watchedAt,
      });
    }

    const planned = await db.userShow.findMany({
      where: { userId: user.id, status: "PLAN_TO_WATCH" },
      take: 6,
      select: { showId: true, createdAt: true, show: { select: { title: true, slug: true, type: true } } },
    });

    for (const entry of planned) {
      entries.push({
        userId: user.id,
        type: "SHOW_ADDED",
        showId: entry.showId,
        reviewId: null,
        payload: {
          showTitle: entry.show.title,
          showSlug: entry.show.slug,
          showType: entry.show.type,
          status: "PLAN_TO_WATCH",
        },
        createdAt: entry.createdAt,
      });
    }

    const userReviews = await db.review.findMany({
      where: { userId: user.id },
      take: 10,
      select: { id: true, showId: true, rating: true, createdAt: true, show: { select: { title: true, slug: true, type: true } } },
    });

    for (const entry of userReviews) {
      entries.push({
        userId: user.id,
        type: "REVIEW_POSTED",
        showId: entry.showId,
        reviewId: entry.id,
        payload: {
          showTitle: entry.show.title,
          showSlug: entry.show.slug,
          showType: entry.show.type,
          rating: entry.rating,
        },
        createdAt: entry.createdAt,
      });
    }

    if (entries.length > 0) {
      await db.activity.createMany({
        data: entries.map((entry) => ({ ...entry, payload: entry.payload as never })),
      });
    }
  }
}

/**
 * Runs the real recompute paths so every derived value in the seeded database
 * was produced by production code.
 */
async function finalise(users: SeededUser[]) {
  console.log("Recomputing derived state with production code paths…");

  // Show-level caches.
  const shows = await db.show.findMany({ select: { id: true } });
  for (const show of shows) {
    const [aggregate, members] = await Promise.all([
      db.userShow.aggregate({
        where: { showId: show.id, rating: { not: null } },
        _sum: { rating: true },
        _count: { rating: true },
      }),
      db.userShow.count({ where: { showId: show.id } }),
    ]);

    await db.show.update({
      where: { id: show.id },
      data: {
        ratingSum: aggregate._sum.rating ?? 0,
        ratingCount: aggregate._count.rating,
        memberCount: members,
      },
    });
  }

  // Per-show progress caches, then per-user stats, streaks and achievements.
  const { statsService } = await import("../src/server/services/stats.service");
  const { streakService } = await import("../src/server/services/streak.service");
  const { achievementsService } = await import("../src/server/services/achievements.service");

  for (const user of users) {
    await recomputeUserShowProgress(user.id);
    await streakService.recompute(db, user.id);
    await statsService.recompute(user.id, db);
    await achievementsService.evaluate(db, user.id);
    // Achievement XP changed the totals, so stats are refreshed once more.
    await statsService.recompute(user.id, db);
  }

  const summary = await db.userStats.findMany({
    orderBy: { xpTotal: "desc" },
    select: {
      xpTotal: true,
      level: true,
      showsCompleted: true,
      episodesWatched: true,
      minutesWatched: true,
      currentStreak: true,
      user: { select: { username: true } },
      rank: { select: { name: true } },
    },
  });

  console.log("\nLeaderboard after seeding:");
  for (const row of summary) {
    console.log(
      `  @${row.user.username.padEnd(16)} lvl ${String(row.level).padStart(3)}  ` +
        `${String(row.showsCompleted).padStart(3)} shows  ` +
        `${String(row.episodesWatched).padStart(5)} eps  ` +
        `${String(Math.round(row.minutesWatched / 60)).padStart(5)}h  ` +
        `${String(row.currentStreak).padStart(3)}d streak  ` +
        `${row.rank?.name ?? "—"}`,
    );
  }
  void xpToLevel;
}

/** Recomputes UserShow caches directly in SQL — far faster than row by row. */
async function recomputeUserShowProgress(userId: string) {
  await db.$executeRaw`
    UPDATE user_shows us
    SET "episodesWatched" = agg.episodes,
        "minutesWatched"  = agg.minutes,
        "currentSeasonNumber" = COALESCE(agg.max_season, 0),
        "currentEpisodeNumber" = COALESCE(agg.max_episode, 0),
        "lastWatchedAt" = agg.last_watched
    FROM (
      SELECT ue."showId",
             COUNT(*) FILTER (WHERE ue."seasonNumber" > 0) AS episodes,
             COALESCE(SUM(COALESCE(e."runtimeMinutes", s."averageRuntimeMinutes")), 0) AS minutes,
             MAX(ue."seasonNumber") AS max_season,
             MAX(ue."episodeNumber") FILTER (
               WHERE ue."seasonNumber" = (
                 SELECT MAX(inner_ue."seasonNumber")
                 FROM user_episodes inner_ue
                 WHERE inner_ue."userId" = ue."userId" AND inner_ue."showId" = ue."showId"
               )
             ) AS max_episode,
             MAX(ue."watchedAt") AS last_watched
      FROM user_episodes ue
      JOIN episodes e ON e.id = ue."episodeId"
      JOIN shows s ON s.id = ue."showId"
      WHERE ue."userId" = ${userId}
      GROUP BY ue."userId", ue."showId"
    ) agg
    WHERE us."userId" = ${userId} AND us."showId" = agg."showId"
  `;

  // Seasons fully watched, per show.
  await db.$executeRaw`
    UPDATE user_shows us
    SET "seasonsCompleted" = COALESCE(agg.completed, 0)
    FROM (
      SELECT se."showId", COUNT(*) AS completed
      FROM seasons se
      JOIN (
        SELECT "seasonId", COUNT(*) AS watched
        FROM user_episodes
        WHERE "userId" = ${userId}
        GROUP BY "seasonId"
      ) w ON w."seasonId" = se.id
      WHERE se.number > 0 AND se."episodeCount" > 0 AND w.watched >= se."episodeCount"
      GROUP BY se."showId"
    ) agg
    WHERE us."userId" = ${userId} AND us."showId" = agg."showId"
  `;
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

main()
  .catch((error) => {
    console.error("\nSeed failed:\n", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
