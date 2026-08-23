/**
 * Date helpers for the tracking domain.
 *
 * Streaks and daily rollups are *calendar* concepts, so every date-keyed value
 * is normalised to UTC midnight. Storing the day as a UTC-midnight `Date` keeps
 * the `@db.Date` columns unambiguous and makes day arithmetic exact integer
 * arithmetic instead of DST-sensitive guessing.
 *
 * Known simplification: days are bucketed in UTC for everyone. A per-user
 * timezone would be a `Profile.timezone` column plus an offset applied here;
 * nothing else in the system would change, because every consumer already goes
 * through `toWatchDate`.
 */

export const MS_PER_DAY = 86_400_000;

/** Normalises any instant to UTC midnight of its calendar day. */
export function toWatchDate(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** `YYYY-MM-DD` for the calendar day of `date`. */
export function toIsoDate(date: Date = new Date()): string {
  return toWatchDate(date).toISOString().slice(0, 10);
}

/** Whole days between two calendar days. Positive when `later` is after `earlier`. */
export function daysBetween(earlier: Date, later: Date): number {
  return Math.round((toWatchDate(later).getTime() - toWatchDate(earlier).getTime()) / MS_PER_DAY);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function isSameDay(a: Date, b: Date): boolean {
  return toWatchDate(a).getTime() === toWatchDate(b).getTime();
}

/** First UTC-midnight instant of the month containing `date`. */
export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function startOfYear(year: number): Date {
  return new Date(Date.UTC(year, 0, 1));
}

export function endOfYear(year: number): Date {
  return new Date(Date.UTC(year + 1, 0, 1));
}

/** `YYYY-MM` bucket key, used by the monthly charts. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
