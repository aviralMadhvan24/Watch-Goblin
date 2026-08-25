import { describe, expect, it } from "vitest";

import { xpDedupeKey, XP_AWARDS } from "@/config/xp";

/**
 * These strings are load-bearing, and the comment in `config/xp.ts` says so:
 * the ledger has a unique index on (userId, dedupeKey), which is the entire
 * anti-farming mechanism. Change a key's shape and every historical award for
 * that reason becomes claimable a second time.
 *
 * So this file asserts the literal output, not a round trip. A test that
 * rebuilt the key the same way the implementation does would pass through any
 * such change, which is exactly the failure it exists to catch.
 */
describe("xpDedupeKey", () => {
  it("produces the exact documented shapes", () => {
    expect(xpDedupeKey.episode("ep1")).toBe("episode:ep1");
    expect(xpDedupeKey.season("se1")).toBe("season:se1");
    expect(xpDedupeKey.show("sh1")).toBe("show:sh1");
    expect(xpDedupeKey.review("rv1")).toBe("review:rv1");
    expect(xpDedupeKey.reviewLike("rv1", "u1")).toBe("review-like:rv1:u1");
    expect(xpDedupeKey.dailyStreak("2026-04-01")).toBe("streak:2026-04-01");
    expect(xpDedupeKey.achievement("ac1")).toBe("achievement:ac1");
    expect(xpDedupeKey.profileCompleted()).toBe("profile:completed");
  });

  it("keys a review like by both review and liker, so one user cannot farm it", () => {
    const byUserA = xpDedupeKey.reviewLike("rv1", "userA");
    const byUserB = xpDedupeKey.reviewLike("rv1", "userB");

    expect(byUserA).not.toBe(byUserB);
    // Re-liking after an unlike must collide with the original award.
    expect(xpDedupeKey.reviewLike("rv1", "userA")).toBe(byUserA);
  });

  it("keeps namespaces disjoint, so an id shared across tables cannot collide", () => {
    const keys = [
      xpDedupeKey.episode("same-id"),
      xpDedupeKey.season("same-id"),
      xpDedupeKey.show("same-id"),
      xpDedupeKey.review("same-id"),
      xpDedupeKey.achievement("same-id"),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives the daily streak one key per calendar day", () => {
    expect(xpDedupeKey.dailyStreak("2026-04-01")).not.toBe(xpDedupeKey.dailyStreak("2026-04-02"));
  });
});

describe("XP_AWARDS", () => {
  it("never awards a negative amount", () => {
    for (const [reason, amount] of Object.entries(XP_AWARDS)) {
      expect(amount, reason).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps achievements at zero, because their reward is per-achievement", () => {
    expect(XP_AWARDS.ACHIEVEMENT_UNLOCKED).toBe(0);
  });

  it("scales rewards by effort: episode < season < show", () => {
    expect(XP_AWARDS.EPISODE_WATCHED).toBeLessThan(XP_AWARDS.SEASON_COMPLETED);
    expect(XP_AWARDS.SEASON_COMPLETED).toBeLessThan(XP_AWARDS.SHOW_COMPLETED);
  });
});
