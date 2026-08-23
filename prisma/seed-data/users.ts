/**
 * Seed personas.
 *
 * Each one is shaped to exercise a different part of the product rather than
 * being random noise: a completionist for the top of the leaderboards, a
 * dropper so the DROPPED empty-states and stats have data, an anime purist and
 * a TV purist so the "anime vs TV" comparison is not symmetric, and a brand
 * new account so first-run empty states are reachable without registering.
 *
 * `intensity` drives how much of the catalogue they get through; `bias` picks
 * which half of it they favour.
 */

export interface SeedUser {
  username: string;
  displayName: string;
  bio: string;
  accentColor: string;
  /** 0..1 — roughly, how much of the catalogue this user has consumed. */
  intensity: number;
  bias: "anime" | "tv" | "balanced";
  /** Share of their library they abandon. */
  dropRate: number;
  /** Days of history to spread activity across. */
  historyDays: number;
  /** Length of their current unbroken streak, if any. */
  currentStreak: number;
  isAdmin?: boolean;
  visibility?: "PUBLIC" | "FOLLOWERS" | "PRIVATE";
}

export const SEED_PASSWORD = "goblinmode2026";

export const SEED_USERS: SeedUser[] = [
  {
    username: "aviral",
    displayName: "Aviral",
    bio: "professional binge consumer",
    accentColor: "#8b5cf6",
    intensity: 0.82,
    bias: "balanced",
    dropRate: 0.12,
    historyDays: 900,
    currentStreak: 17,
    isAdmin: true,
  },
  {
    username: "showdestroyer",
    displayName: "Show Destroyer",
    bio: "i do not have a job and it shows",
    accentColor: "#f472b6",
    intensity: 0.97,
    bias: "balanced",
    dropRate: 0.05,
    historyDays: 1100,
    currentStreak: 43,
  },
  {
    username: "netflixcriminal",
    displayName: "netflix criminal",
    bio: "5 profiles, none of them mine",
    accentColor: "#fb7185",
    intensity: 0.88,
    bias: "tv",
    dropRate: 0.18,
    historyDays: 800,
    currentStreak: 6,
  },
  {
    username: "hikikomori",
    displayName: "hikikomori",
    bio: "the door is load-bearing",
    accentColor: "#22d3ee",
    intensity: 0.85,
    bias: "anime",
    dropRate: 0.08,
    historyDays: 1000,
    currentStreak: 61,
  },
  {
    username: "erenposting",
    displayName: "eren posting",
    bio: "tatakae. that is the whole bio.",
    accentColor: "#34d399",
    intensity: 0.55,
    bias: "anime",
    dropRate: 0.1,
    historyDays: 600,
    currentStreak: 0,
  },
  {
    username: "animeaddict",
    displayName: "anime addict",
    bio: "sub only. this is not a debate.",
    accentColor: "#a78bfa",
    intensity: 0.7,
    bias: "anime",
    dropRate: 0.15,
    historyDays: 700,
    currentStreak: 12,
  },
  {
    username: "prestigetv",
    displayName: "Prestige TV Only",
    bio: "if it is under 8.5 on the aggregate i am not watching it",
    accentColor: "#f59e0b",
    intensity: 0.48,
    bias: "tv",
    dropRate: 0.22,
    historyDays: 900,
    currentStreak: 3,
  },
  {
    username: "serialdropper",
    displayName: "serial dropper",
    bio: "three episodes in and out. commitment issues confirmed.",
    accentColor: "#ef4444",
    intensity: 0.4,
    bias: "balanced",
    dropRate: 0.62,
    historyDays: 500,
    currentStreak: 0,
  },
  {
    username: "john",
    displayName: "John",
    bio: "normal amount of television",
    accentColor: "#38bdf8",
    intensity: 0.3,
    bias: "tv",
    dropRate: 0.2,
    historyDays: 400,
    currentStreak: 2,
  },
  {
    username: "weekendwarrior",
    displayName: "weekend warrior",
    bio: "monday to friday i am a functioning adult",
    accentColor: "#eab308",
    intensity: 0.35,
    bias: "balanced",
    dropRate: 0.14,
    historyDays: 450,
    currentStreak: 1,
  },
  {
    username: "lurker",
    displayName: "lurker",
    bio: "watching. always watching.",
    accentColor: "#94a3b8",
    intensity: 0.25,
    bias: "anime",
    dropRate: 0.3,
    historyDays: 300,
    currentStreak: 0,
    visibility: "FOLLOWERS",
  },
  {
    username: "freshgoblin",
    displayName: "fresh goblin",
    bio: "just got here",
    accentColor: "#8b5cf6",
    intensity: 0,
    bias: "balanced",
    dropRate: 0,
    historyDays: 0,
    currentStreak: 0,
  },
];

/** Review bodies, paired with the rating band they suit. */
export const REVIEW_TEMPLATES: {
  min: number;
  bodies: string[];
  spoiler?: boolean;
}[] = [
  {
    min: 4.5,
    bodies: [
      "Watched this in two sittings and then sat in silence for a while. Genuinely does not have a wasted episode.",
      "I went in expecting to like it and came out annoyed at everything else I have watched this year.",
      "Peak. Not in the ironic way. The actual thing.",
      "Rewatched immediately. Caught about forty things I missed. Still not over it.",
    ],
  },
  {
    min: 4,
    bodies: [
      "Excellent, with maybe one arc that overstays its welcome. Still an easy recommend.",
      "Very good. Loses half a star for a finale that clearly ran out of budget.",
      "This got me out of a six month watching slump. Whatever it is doing, it works.",
    ],
  },
  {
    min: 3,
    bodies: [
      "Solid. Not going to change your life but nothing here is bad.",
      "First half is great, second half is fine, and I am fine with that.",
      "Good background show that I accidentally paid full attention to.",
      "Watchable. Occasionally excellent. Mostly just watchable.",
    ],
  },
  {
    min: 2,
    bodies: [
      "Kept going out of stubbornness. Would not recommend the stubbornness.",
      "The premise deserved a much better version of this.",
      "It is not offensive, it is just there. Which is somehow worse.",
    ],
  },
  {
    min: 0.5,
    bodies: [
      "Dropped it and felt physically lighter.",
      "I want those hours back and I know I cannot have them.",
      "Every episode I asked myself why I was doing this. Never got an answer.",
    ],
  },
];

export const SPOILER_REVIEWS = [
  "The moment in the finale where the whole framing device turns out to be a confession recontextualises every single episode. I had to stop and go back to the pilot.",
  "Killing that character off at the midpoint is the bravest thing this show does, and it never really recovers its centre afterwards. On purpose, I think.",
];
