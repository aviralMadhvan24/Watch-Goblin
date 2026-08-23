import { LEVEL_CURVE } from "@/config/xp";

/**
 * Pure level maths. No I/O, no Prisma — this is the piece the unit tests pin
 * down, and the piece the rest of the app is not allowed to reimplement.
 *
 * The curve is  cumulativeXp(level) = BASE * (level - 1) ^ EXPONENT,
 * which inverts cleanly, so resolving a level from XP is O(1) rather than a
 * loop over a table of thresholds.
 */

/** Total XP required to *reach* `level`. Level 1 costs nothing. */
export function levelToXp(level: number): number {
  const clamped = Math.min(Math.max(Math.floor(level), 1), LEVEL_CURVE.MAX_LEVEL);
  if (clamped <= 1) return 0;
  return Math.round(LEVEL_CURVE.BASE * Math.pow(clamped - 1, LEVEL_CURVE.EXPONENT));
}

/** The level a given XP total corresponds to. */
export function xpToLevel(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  const raw = Math.pow(xp / LEVEL_CURVE.BASE, 1 / LEVEL_CURVE.EXPONENT) + 1;
  // Guard against float drift landing a hair under an exact threshold.
  const level = Math.floor(raw + 1e-9);
  return Math.min(Math.max(level, 1), LEVEL_CURVE.MAX_LEVEL);
}

export interface LevelProgress {
  level: number;
  xpTotal: number;
  /** XP earned since entering the current level. */
  xpIntoLevel: number;
  /** XP needed to span the current level. `null` at max level. */
  xpForLevel: number | null;
  /** XP still required to level up. `null` at max level. */
  xpToNextLevel: number | null;
  /** 0..1 progress through the current level. 1 at max level. */
  progress: number;
  isMaxLevel: boolean;
}

/** Everything a progress bar needs, derived from an XP total alone. */
export function getLevelProgress(xpTotal: number): LevelProgress {
  const xp = Math.max(0, Math.floor(xpTotal || 0));
  const level = xpToLevel(xp);
  const isMaxLevel = level >= LEVEL_CURVE.MAX_LEVEL;

  const currentThreshold = levelToXp(level);
  const nextThreshold = isMaxLevel ? null : levelToXp(level + 1);

  const xpIntoLevel = xp - currentThreshold;
  const xpForLevel = nextThreshold === null ? null : nextThreshold - currentThreshold;

  return {
    level,
    xpTotal: xp,
    xpIntoLevel,
    xpForLevel,
    xpToNextLevel: nextThreshold === null ? null : nextThreshold - xp,
    progress:
      xpForLevel === null || xpForLevel <= 0
        ? 1
        : Math.min(1, Math.max(0, xpIntoLevel / xpForLevel)),
    isMaxLevel,
  };
}
