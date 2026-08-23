/**
 * Everything name-shaped lives here so rebranding is a one-file change.
 * No other module should hard-code the product name.
 */
export const brand = {
  name: "WatchGoblin",
  shortName: "WG",
  domain: "watchgoblin.com",
  tagline: "Track every episode. Flex the damage.",
  description:
    "Track anime and TV down to the episode, earn ranks nobody should be proud of, and find out whether your friends have less of a life than you.",
  /** Used for OpenGraph, share cards and the @handle in exported images. */
  socialHandle: "@watchgoblin",
  mascot: "👺",
} as const;

/**
 * The humour layer. Copy is centralised so it can be tuned (or switched off per
 * user via `Profile.humorEnabled`) without hunting through components.
 *
 * Rule of thumb: the joke goes in the *empty* and *celebratory* states. Errors,
 * forms and destructive confirmations stay plain — a bit is not worth confusing
 * someone who is trying to delete their account.
 */
export const copy = {
  empty: {
    library: {
      title: "Bro watched NOTHING 💀",
      body: "Your library is emptier than your calendar. Go add something.",
      cta: "Find a show",
    },
    watchlist: {
      title: "Your watchlist is emptier than your social life",
      body: "Add a few shows you will absolutely never get around to.",
      cta: "Browse shows",
    },
    completed: {
      title: "You have not finished anything yet",
      body: "Character development starts now.",
      cta: "Continue watching",
    },
    followers: {
      title: "Nobody is watching you",
      body: "Yet.",
      cta: "Find people",
    },
    following: {
      title: "You follow exactly zero people",
      body: "Competing against nobody is easy but unsatisfying.",
      cta: "Find people",
    },
    feed: {
      title: "Your feed is a ghost town",
      body: "Follow some people so you have someone to feel superior to.",
      cta: "Find people",
    },
    reviews: {
      title: "No reviews yet",
      body: "Be the first to have an opinion nobody asked for.",
      cta: "Write a review",
    },
    activity: {
      title: "Nothing has happened",
      body: "Suspiciously well-adjusted of you.",
      cta: "Start tracking",
    },
    search: {
      title: "Nothing matched",
      body: "Either it does not exist or you cannot spell. Both are possible.",
      cta: "Clear search",
    },
    achievements: {
      title: "Zero achievements",
      body: "The bar is on the floor and you are limbo-ing under it.",
      cta: "Go watch something",
    },
  },
  celebrate: {
    showCompleted: "You actually finished something. Rare W.",
    seasonCompleted: "Season down. One less thing haunting your backlog.",
    firstEpisode: "It begins. Say goodbye to your evening.",
    levelUp: "Level up. Your productivity did not survive this.",
    achievement: "Achievement unlocked. Frame it, it is all you have.",
    streakMilestone: "The streak lives. Grass remains untouched.",
  },
  streak: {
    broken: "The grass won.",
    atRisk: "Watch something today or the streak dies.",
  },
  /** Neutral, unfunny strings — used when `humorEnabled` is false. */
  plain: {
    empty: {
      library: { title: "No shows yet", body: "Add a show to get started." },
      watchlist: { title: "Nothing planned", body: "Add shows you want to watch." },
      completed: { title: "Nothing completed", body: "Finish a show to see it here." },
      followers: { title: "No followers yet", body: "" },
      following: { title: "Not following anyone", body: "" },
      feed: { title: "No activity", body: "Follow people to fill your feed." },
      reviews: { title: "No reviews yet", body: "" },
      activity: { title: "No activity yet", body: "" },
      search: { title: "No results", body: "Try a different search." },
      achievements: { title: "No achievements yet", body: "" },
    },
    celebrate: {
      showCompleted: "Show marked as completed.",
      seasonCompleted: "Season completed.",
      firstEpisode: "Episode marked as watched.",
      levelUp: "You reached a new level.",
      achievement: "Achievement unlocked.",
      streakMilestone: "Streak milestone reached.",
    },
    streak: {
      broken: "Your watch streak ended.",
      atRisk: "Watch something today to keep your streak.",
    },
  },
} as const;

export type EmptyStateKey = keyof typeof copy.empty;
