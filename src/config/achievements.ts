/**
 * Achievement catalogue, seeded into the `achievements` table.
 *
 * Every achievement is expressed as `metric >= threshold`, which means the
 * evaluator is a single generic function rather than a pile of bespoke
 * conditions — adding an achievement is appending a row here (or inserting one
 * from the admin UI) and nothing else.
 *
 * If a future achievement genuinely cannot be expressed as a metric threshold,
 * add a new value to the `AchievementMetric` enum and teach the metric
 * collector (src/server/services/achievements/metrics.ts) how to compute it.
 * The evaluator itself does not change.
 */

import type {
  AchievementCategory,
  AchievementMetric,
} from "@/generated/prisma/enums";

export interface AchievementDefinition {
  code: string;
  name: string;
  description: string;
  icon: string;
  category: AchievementCategory;
  metric: AchievementMetric;
  threshold: number;
  xpReward: number;
  isSecret?: boolean;
}

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  // --- Milestones: shows completed -----------------------------------------
  {
    code: "first-blood",
    name: "First Blood",
    description: "Complete your first show.",
    icon: "🏆",
    category: "MILESTONE",
    metric: "SHOWS_COMPLETED",
    threshold: 1,
    xpReward: 100,
  },
  {
    code: "getting-serious",
    name: "Getting Serious",
    description: "Complete 10 shows.",
    icon: "📀",
    category: "MILESTONE",
    metric: "SHOWS_COMPLETED",
    threshold: 10,
    xpReward: 250,
  },
  {
    code: "lore-keeper",
    name: "Lore Keeper",
    description: "Complete 50 shows.",
    icon: "🧠",
    category: "MILESTONE",
    metric: "SHOWS_COMPLETED",
    threshold: 50,
    xpReward: 750,
  },
  {
    code: "completionist",
    name: "Completionist",
    description: "Complete 100 shows.",
    icon: "🐐",
    category: "MILESTONE",
    metric: "SHOWS_COMPLETED",
    threshold: 100,
    xpReward: 1500,
  },
  {
    code: "archivist",
    name: "Archivist",
    description: "Complete 250 shows.",
    icon: "🗂️",
    category: "MILESTONE",
    metric: "SHOWS_COMPLETED",
    threshold: 250,
    xpReward: 3000,
  },

  // --- Episodes watched ----------------------------------------------------
  {
    code: "no-social-life",
    name: "No Social Life",
    description: "Watch 100 episodes.",
    icon: "💀",
    category: "MILESTONE",
    metric: "EPISODES_WATCHED",
    threshold: 100,
    xpReward: 200,
  },
  {
    code: "touch-grassnt",
    name: "Touch Grassn't",
    description: "Watch 500 episodes.",
    icon: "🌱",
    category: "MILESTONE",
    metric: "EPISODES_WATCHED",
    threshold: 500,
    xpReward: 600,
  },
  {
    code: "netflix-employee",
    name: "Netflix Employee",
    description: "Watch 1,000 episodes.",
    icon: "📺",
    category: "MILESTONE",
    metric: "EPISODES_WATCHED",
    threshold: 1000,
    xpReward: 1200,
  },
  {
    code: "grass-extinct",
    name: "Grass Extinct",
    description: "Watch 5,000 episodes.",
    icon: "☠️",
    category: "MILESTONE",
    metric: "EPISODES_WATCHED",
    threshold: 5000,
    xpReward: 5000,
  },

  // --- Binge ---------------------------------------------------------------
  {
    code: "binge-baby",
    name: "Binge Baby",
    description: "Watch 10 episodes in a single day.",
    icon: "🍿",
    category: "BINGE",
    metric: "EPISODES_IN_ONE_DAY",
    threshold: 10,
    xpReward: 150,
  },
  {
    code: "weekend-destroyer",
    name: "Weekend Destroyer",
    description: "Watch 20 episodes in a single day.",
    icon: "🌪️",
    category: "BINGE",
    metric: "EPISODES_IN_ONE_DAY",
    threshold: 20,
    xpReward: 400,
  },
  {
    code: "sleep-is-optional",
    name: "Sleep Is Optional",
    description: "Watch 40 episodes in a single day.",
    icon: "🦉",
    category: "BINGE",
    metric: "EPISODES_IN_ONE_DAY",
    threshold: 40,
    xpReward: 900,
  },
  {
    code: "one-week-gone",
    name: "One Week Gone",
    description: "Accumulate 168 hours of watch time. A whole week. Gone.",
    icon: "⏳",
    category: "BINGE",
    metric: "MINUTES_WATCHED",
    threshold: 168 * 60,
    xpReward: 800,
  },

  // --- Streaks -------------------------------------------------------------
  {
    code: "warming-up",
    name: "Warming Up",
    description: "Reach a 7 day watch streak.",
    icon: "🔥",
    category: "STREAK",
    metric: "LONGEST_STREAK",
    threshold: 7,
    xpReward: 150,
  },
  {
    code: "unbroken",
    name: "Unbroken",
    description: "Reach a 30 day watch streak.",
    icon: "🔥",
    category: "STREAK",
    metric: "LONGEST_STREAK",
    threshold: 30,
    xpReward: 600,
  },
  {
    code: "the-grass-gave-up",
    name: "The Grass Gave Up",
    description: "Reach a 100 day watch streak.",
    icon: "🌋",
    category: "STREAK",
    metric: "LONGEST_STREAK",
    threshold: 100,
    xpReward: 2000,
  },

  // --- Anime ---------------------------------------------------------------
  {
    code: "anime-curious",
    name: "Anime Curious",
    description: "Complete 10 anime.",
    icon: "🎌",
    category: "ANIME",
    metric: "ANIME_COMPLETED",
    threshold: 10,
    xpReward: 250,
  },
  {
    code: "anime-veteran",
    name: "Anime Veteran",
    description: "Complete 50 anime.",
    icon: "⚔️",
    category: "ANIME",
    metric: "ANIME_COMPLETED",
    threshold: 50,
    xpReward: 900,
  },
  {
    code: "subbed-not-dubbed",
    name: "Subbed Not Dubbed",
    description: "Complete 100 anime. You have opinions now.",
    icon: "🗾",
    category: "ANIME",
    metric: "ANIME_COMPLETED",
    threshold: 100,
    xpReward: 1800,
  },

  // --- TV ------------------------------------------------------------------
  {
    code: "tv-goblin",
    name: "TV Goblin",
    description: "Complete 50 TV shows.",
    icon: "📡",
    category: "TV",
    metric: "TV_COMPLETED",
    threshold: 50,
    xpReward: 900,
  },
  {
    code: "prestige-drama-enjoyer",
    name: "Prestige Drama Enjoyer",
    description: "Complete 25 TV shows.",
    icon: "🎬",
    category: "TV",
    metric: "TV_COMPLETED",
    threshold: 25,
    xpReward: 450,
  },
  {
    code: "season-slayer",
    name: "Season Slayer",
    description: "Complete 100 seasons.",
    icon: "🗡️",
    category: "TV",
    metric: "SEASONS_COMPLETED",
    threshold: 100,
    xpReward: 700,
  },

  // --- Social --------------------------------------------------------------
  {
    code: "critic",
    name: "Critic",
    description: "Post 10 reviews.",
    icon: "✍️",
    category: "SOCIAL",
    metric: "REVIEWS_POSTED",
    threshold: 10,
    xpReward: 250,
  },
  {
    code: "certified-yapper",
    name: "Certified Yapper",
    description: "Post 50 reviews.",
    icon: "🗣️",
    category: "SOCIAL",
    metric: "REVIEWS_POSTED",
    threshold: 50,
    xpReward: 800,
  },
  {
    code: "based-take",
    name: "Based Take",
    description: "Receive 50 likes across your reviews.",
    icon: "💯",
    category: "SOCIAL",
    metric: "REVIEW_LIKES_RECEIVED",
    threshold: 50,
    xpReward: 500,
  },
  {
    code: "mildly-famous",
    name: "Mildly Famous",
    description: "Reach 25 followers.",
    icon: "🌟",
    category: "SOCIAL",
    metric: "FOLLOWERS",
    threshold: 25,
    xpReward: 500,
  },

  // --- Special -------------------------------------------------------------
  {
    code: "double-digits",
    name: "Double Digits",
    description: "Reach level 10.",
    icon: "🔟",
    category: "SPECIAL",
    metric: "LEVEL",
    threshold: 10,
    xpReward: 300,
  },
  {
    code: "goblin-mode",
    name: "Goblin Mode",
    description: "Reach level 40.",
    icon: "👺",
    category: "SPECIAL",
    metric: "LEVEL",
    threshold: 40,
    xpReward: 2000,
  },
  {
    code: "final-boss",
    name: "Final Boss",
    description: "Reach level 100. There was never a point. You did it anyway.",
    icon: "👑",
    category: "SPECIAL",
    metric: "LEVEL",
    threshold: 100,
    xpReward: 10000,
    isSecret: true,
  },
];
