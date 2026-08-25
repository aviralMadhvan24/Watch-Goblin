/**
 * Rebuilds every user's denormalised counters from the underlying facts.
 *
 * `user_stats` is a cache: episodes watched, minutes, completed seasons and
 * shows, follower counts and XP are all derivable from `user_shows`,
 * `user_episodes`, `follows` and the `xp_events` ledger. `statsService.recompute`
 * is the authoritative derivation; the tracking service maintains the same
 * numbers incrementally because a leaderboard cannot aggregate a whole history
 * per row.
 *
 * Run this after fixing a bug in the incremental path — drifted counters do not
 * heal on their own, and they are indexed columns that rank users publicly.
 *
 * Usage:
 *   npm run stats:recompute            # every user
 *   npm run stats:recompute -- --user <id>
 */

// Must precede any import that reads env at module scope.
import "dotenv/config";

import { db } from "@/db/client";
import { statsService } from "@/server/services/stats.service";

async function main() {
  const argv = process.argv.slice(2);
  const userFlag = argv.indexOf("--user");
  const only = userFlag >= 0 ? argv[userFlag + 1] : undefined;

  const users = await db.user.findMany({
    where: only ? { id: only } : undefined,
    select: { id: true, username: true },
    orderBy: { createdAt: "asc" },
  });

  if (users.length === 0) {
    console.log(only ? `No user with id "${only}".` : "No users to recompute.");
    return;
  }

  console.log(`Recomputing stats for ${users.length} user(s)…\n`);

  let changed = 0;

  for (const [index, user] of users.entries()) {
    const position = `${String(index + 1).padStart(4)}/${users.length}`;

    const before = await db.userStats.findUnique({
      where: { userId: user.id },
      select: {
        episodesWatched: true,
        minutesWatched: true,
        seasonsCompleted: true,
        showsCompleted: true,
        xpTotal: true,
      },
    });

    await statsService.recompute(user.id);

    const after = await db.userStats.findUniqueOrThrow({
      where: { userId: user.id },
      select: {
        episodesWatched: true,
        minutesWatched: true,
        seasonsCompleted: true,
        showsCompleted: true,
        xpTotal: true,
      },
    });

    // Reported per field, because "something drifted" is far less useful than
    // knowing *which* counter drifted and by how much.
    const drift = Object.entries(after)
      .filter(([key, value]) => before?.[key as keyof typeof after] !== value)
      .map(([key, value]) => `${key} ${before?.[key as keyof typeof after] ?? "-"} → ${value}`);

    if (drift.length > 0) {
      console.log(`${position}  FIXED  ${user.username}: ${drift.join(", ")}`);
      changed += 1;
    } else {
      console.log(`${position}  ok     ${user.username}`);
    }
  }

  console.log(
    `\nRecomputed ${users.length}, corrected ${changed}.` +
      (changed === 0 ? "\nNo drift found — the incremental path and the derivation agree." : ""),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
