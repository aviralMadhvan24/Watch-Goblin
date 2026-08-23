/**
 * Display formatting. Pure functions, safe on both server and client, so a
 * number is rendered identically wherever it appears (and hydration never
 * disagrees with the server).
 */

const numberFormatter = new Intl.NumberFormat("en-US");

export function formatNumber(value: number): string {
  return numberFormatter.format(Math.round(value || 0));
}

/** 1200 -> "1.2k", 1_284_000 -> "1.3M". Used in tight card layouts. */
export function formatCompact(value: number): string {
  const n = Math.round(value || 0);
  if (Math.abs(n) < 1000) return String(n);
  if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatHours(minutes: number): string {
  return formatNumber(Math.floor((minutes || 0) / 60));
}

/** "1,927 hours" style headline number. */
export function minutesToHours(minutes: number): number {
  return Math.floor((minutes || 0) / 60);
}

export function minutesToDays(minutes: number): number {
  return (minutes || 0) / 60 / 24;
}

/** "21.4 days" — the number the wrapped screen is built around. */
export function formatDays(minutes: number): string {
  const days = minutesToDays(minutes);
  return `${days.toFixed(1)} days`;
}

/** "3d 4h 20m" for a precise breakdown. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes || 0));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(" ");
}

/** "S04E03". Season 0 renders as "Special E03". */
export function formatEpisodeCode(seasonNumber: number, episodeNumber: number): string {
  if (seasonNumber === 0) return `Special E${String(episodeNumber).padStart(2, "0")}`;
  return `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
}

export function formatRating(rating: number | null | undefined): string {
  if (rating === null || rating === undefined) return "—";
  return rating.toFixed(1);
}

export function formatYear(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return Number.isNaN(d.getTime()) ? "—" : String(d.getUTCFullYear());
}

/** Compact relative time: "just now", "3h ago", "yesterday", "12 Mar". */
export function formatRelativeTime(value: Date | string, now: Date = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";

  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;

  const days = Math.floor(seconds / 86_400);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 365) {
    return date.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
  }
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Pluralise without pulling in a library. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

export function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}
