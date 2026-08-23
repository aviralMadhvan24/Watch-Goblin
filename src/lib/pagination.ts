/**
 * Cursor pagination.
 *
 * Feeds, libraries and activity lists are all "newest first, keeps growing",
 * which is exactly where OFFSET falls over: it gets slower the deeper you go
 * and silently skips or repeats rows when new items arrive mid-scroll. So the
 * infinite lists use opaque cursors, and only the leaderboard — which is
 * page-numbered by nature — uses offsets.
 */

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Encodes a sort key plus tiebreaker id into an opaque, URL-safe cursor. */
export function encodeCursor(sortValue: Date | number | string, id: string): string {
  const raw =
    sortValue instanceof Date ? sortValue.toISOString() : String(sortValue);
  return Buffer.from(`${raw}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { sortValue: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = decoded.lastIndexOf("|");
    if (separator <= 0) return null;
    return { sortValue: decoded.slice(0, separator), id: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

/**
 * Turns an over-fetched result set into a page. Callers ask for `limit + 1`
 * rows; the extra row is the proof that another page exists, and is dropped.
 */
export function buildCursorPage<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => string,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore && items.length > 0 ? toCursor(items[items.length - 1]) : null,
  };
}

export function normalizeLimit(limit: number | undefined, fallback = DEFAULT_PAGE_SIZE): number {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(Math.floor(limit), MAX_PAGE_SIZE);
}

export interface OffsetPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function buildOffsetPage<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): OffsetPage<T> {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
