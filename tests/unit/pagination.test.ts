import { describe, expect, it } from "vitest";

import {
  buildCursorPage,
  decodeCursor,
  encodeCursor,
  normalizeLimit,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "@/lib/pagination";

describe("cursors", () => {
  it("round-trips a date sort key and an id", () => {
    const at = new Date("2026-04-01T10:20:30.000Z");

    expect(decodeCursor(encodeCursor(at, "cuid-1"))).toEqual({
      sortValue: at.toISOString(),
      id: "cuid-1",
    });
  });

  it("round-trips a numeric sort key", () => {
    expect(decodeCursor(encodeCursor(4200, "cuid-2"))).toEqual({
      sortValue: "4200",
      id: "cuid-2",
    });
  });

  it("splits on the last separator, so a sort value containing one survives", () => {
    expect(decodeCursor(encodeCursor("a|b|c", "cuid-3"))).toEqual({
      sortValue: "a|b|c",
      id: "cuid-3",
    });
  });

  it("is URL-safe, since cursors travel in the query string", () => {
    const cursor = encodeCursor(new Date("2026-04-01T10:20:30.000Z"), "cuid-4");
    expect(cursor).toBe(encodeURIComponent(cursor));
  });

  it("returns null for junk rather than throwing", () => {
    // This input is attacker-controlled: it arrives straight off the URL.
    expect(decodeCursor("not a cursor at all")).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
});

describe("buildCursorPage", () => {
  const toCursor = (row: { id: string }) => row.id;

  it("drops the over-fetched proof row and returns a next cursor", () => {
    const page = buildCursorPage([{ id: "a" }, { id: "b" }, { id: "c" }], 2, toCursor);

    expect(page.items).toEqual([{ id: "a" }, { id: "b" }]);
    expect(page.nextCursor).toBe("b");
  });

  it("reports no next page when the result set did not overflow", () => {
    const page = buildCursorPage([{ id: "a" }, { id: "b" }], 2, toCursor);

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("handles an empty result set", () => {
    expect(buildCursorPage([], 10, toCursor)).toEqual({ items: [], nextCursor: null });
  });
});

describe("normalizeLimit", () => {
  it("falls back for missing or nonsensical values", () => {
    expect(normalizeLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizeLimit(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizeLimit(-10)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizeLimit(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
  });

  it("caps the page size, since this also comes from the query string", () => {
    expect(normalizeLimit(10_000)).toBe(MAX_PAGE_SIZE);
  });

  it("floors a fractional limit", () => {
    expect(normalizeLimit(12.9)).toBe(12);
  });

  it("honours a caller-supplied fallback", () => {
    expect(normalizeLimit(undefined, 8)).toBe(8);
  });
});
