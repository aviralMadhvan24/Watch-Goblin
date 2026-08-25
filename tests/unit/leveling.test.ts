import { describe, expect, it } from "vitest";

import { LEVEL_CURVE } from "@/config/xp";
import { getLevelProgress, levelToXp, xpToLevel } from "@/lib/leveling";

/**
 * The level curve is the one piece of maths the UI, the XP service and the
 * leaderboard all depend on, and `xpToLevel` is an inverted power function —
 * exactly the shape where float drift puts someone one XP short of a level they
 * have paid for. These tests pin the boundaries.
 */
describe("levelToXp", () => {
  it("costs nothing to be level 1", () => {
    expect(levelToXp(1)).toBe(0);
  });

  it("is strictly increasing", () => {
    for (let level = 2; level <= LEVEL_CURVE.MAX_LEVEL; level += 1) {
      expect(levelToXp(level)).toBeGreaterThan(levelToXp(level - 1));
    }
  });

  it("clamps out-of-range levels instead of returning nonsense", () => {
    expect(levelToXp(0)).toBe(0);
    expect(levelToXp(-5)).toBe(0);
    expect(levelToXp(LEVEL_CURVE.MAX_LEVEL + 50)).toBe(levelToXp(LEVEL_CURVE.MAX_LEVEL));
  });
});

describe("xpToLevel", () => {
  it("treats zero and junk input as level 1", () => {
    expect(xpToLevel(0)).toBe(1);
    expect(xpToLevel(-100)).toBe(1);
    expect(xpToLevel(Number.NaN)).toBe(1);
    expect(xpToLevel(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("awards the level exactly at its threshold, not one XP later", () => {
    // The float-drift guard in `xpToLevel` exists for this case specifically:
    // `Math.pow(Math.pow(x, 2.5), 1/2.5)` does not always land back on x.
    for (let level = 2; level <= LEVEL_CURVE.MAX_LEVEL; level += 1) {
      expect(xpToLevel(levelToXp(level))).toBe(level);
    }
  });

  it("does not award a level one XP before its threshold", () => {
    for (let level = 3; level <= LEVEL_CURVE.MAX_LEVEL; level += 1) {
      expect(xpToLevel(levelToXp(level) - 1)).toBe(level - 1);
    }
  });

  it("caps at the maximum level", () => {
    expect(xpToLevel(levelToXp(LEVEL_CURVE.MAX_LEVEL) * 1000)).toBe(LEVEL_CURVE.MAX_LEVEL);
  });
});

describe("getLevelProgress", () => {
  it("reports a fresh level as zero progress", () => {
    const progress = getLevelProgress(levelToXp(10));

    expect(progress.level).toBe(10);
    expect(progress.xpIntoLevel).toBe(0);
    expect(progress.progress).toBe(0);
    expect(progress.isMaxLevel).toBe(false);
    expect(progress.xpToNextLevel).toBe(levelToXp(11) - levelToXp(10));
  });

  it("reports the halfway point as roughly half", () => {
    const span = levelToXp(11) - levelToXp(10);
    const progress = getLevelProgress(levelToXp(10) + Math.floor(span / 2));

    expect(progress.level).toBe(10);
    expect(progress.progress).toBeGreaterThan(0.45);
    expect(progress.progress).toBeLessThan(0.55);
  });

  it("saturates at max level rather than dividing by a null span", () => {
    const progress = getLevelProgress(levelToXp(LEVEL_CURVE.MAX_LEVEL) + 5_000);

    expect(progress.isMaxLevel).toBe(true);
    expect(progress.progress).toBe(1);
    expect(progress.xpToNextLevel).toBeNull();
    expect(progress.xpForLevel).toBeNull();
  });

  it("floors fractional and negative XP totals", () => {
    expect(getLevelProgress(-50).xpTotal).toBe(0);
    expect(getLevelProgress(120.9).xpTotal).toBe(120);
  });
});
