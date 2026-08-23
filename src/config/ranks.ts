/**
 * Rank definitions. These are seeded into the `ranks` table — the database is
 * the runtime source of truth so ranks can be added or renamed by an admin
 * without a deploy. This file is the canonical *seed*, and the same shape the
 * admin UI writes.
 *
 * To add a rank: append an entry and re-run `npm run db:seed` (the seed
 * upserts by slug, so existing users keep their level and simply re-resolve to
 * whichever rank now covers them).
 */

import { levelToXp } from "@/lib/leveling";

export interface RankDefinition {
  slug: string;
  name: string;
  description: string;
  icon: string;
  minLevel: number;
  accentColor: string;
}

export const RANK_DEFINITIONS: RankDefinition[] = [
  {
    slug: "just-one-episode-bro",
    name: "Just One Episode Bro",
    description: "The lie that started it all.",
    icon: "🐣",
    minLevel: 1,
    accentColor: "#94a3b8",
  },
  {
    slug: "weekend-watcher",
    name: "Weekend Watcher",
    description: "Still has plans on weekdays. Enjoy it while it lasts.",
    icon: "🛋️",
    minLevel: 5,
    accentColor: "#38bdf8",
  },
  {
    slug: "professional-binger",
    name: "Professional Binger",
    description: "Autoplay has never once been allowed to finish its countdown.",
    icon: "🍿",
    minLevel: 10,
    accentColor: "#22d3ee",
  },
  {
    slug: "chronically-online",
    name: "Chronically Online",
    description: "Knows the release schedule better than their own.",
    icon: "📡",
    minLevel: 20,
    accentColor: "#a78bfa",
  },
  {
    slug: "touch-grassnt",
    name: "Touch Grassn't",
    description: "Outside is a rumour at this point.",
    icon: "🌱",
    minLevel: 30,
    accentColor: "#34d399",
  },
  {
    slug: "certified-screen-goblin",
    name: "Certified Screen Goblin",
    description: "Nocturnal. Backlit. Unstoppable.",
    icon: "👺",
    minLevel: 40,
    accentColor: "#f472b6",
  },
  {
    slug: "netflix-shareholder",
    name: "Netflix Shareholder",
    description: "Personally responsible for at least one renewal.",
    icon: "💸",
    minLevel: 50,
    accentColor: "#fb7185",
  },
  {
    slug: "anime-industrial-complex",
    name: "Anime Industrial Complex",
    description: "A one-person production committee.",
    icon: "⚙️",
    minLevel: 60,
    accentColor: "#f59e0b",
  },
  {
    slug: "grass-has-been-uninstalled",
    name: "Grass Has Been Uninstalled",
    description: "The lawn filed a missing person report.",
    icon: "🚫",
    minLevel: 75,
    accentColor: "#ef4444",
  },
  {
    slug: "final-boss-of-watching-tv",
    name: "Final Boss of Watching TV",
    description: "There is nothing left to watch. There is nothing left.",
    icon: "👑",
    minLevel: 100,
    accentColor: "#eab308",
  },
];

/**
 * Expands the definitions into rows, deriving each rank's XP window from the
 * level curve so the two systems can never drift apart.
 */
export function buildRankRows() {
  const sorted = [...RANK_DEFINITIONS].sort((a, b) => a.minLevel - b.minLevel);

  return sorted.map((rank, index) => {
    const next = sorted[index + 1];
    return {
      ...rank,
      minXp: levelToXp(rank.minLevel),
      maxXp: next ? levelToXp(next.minLevel) - 1 : null,
    };
  });
}
