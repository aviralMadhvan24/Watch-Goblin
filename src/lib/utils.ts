import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware class merge used by every component in the design system. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Combining diacritical marks, stripped after NFKD normalisation. */
const DIACRITICS = /[̀-ͯ]/g;
/** Straight and curly apostrophes, dropped rather than turned into hyphens. */
const APOSTROPHES = /['’]/g;

/** URL-safe slug. Output is always ASCII, so slugs stay stable and routable. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Percentage 0..100, guarding against a zero total. */
export function percentage(part: number, total: number): number {
  if (!total || total <= 0) return 0;
  return clamp((part / total) * 100, 0, 100);
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

/** Splits an array into fixed-size chunks (used for batched DB writes). */
export function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/** Deterministic pick from a list, so the same seed always yields the same item. */
export function pickDeterministic<T>(values: readonly T[], seed: string): T {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return values[Math.abs(hash) % values.length];
}
