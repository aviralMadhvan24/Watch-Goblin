import { describe, expect, it } from "vitest";

import { addDays, daysBetween, isSameDay, monthKey, toIsoDate, toWatchDate } from "@/lib/dates";

/**
 * Streaks are integer day arithmetic on UTC-midnight dates. If `toWatchDate`
 * ever stops normalising, "watched at 23:00 then again at 01:00" silently
 * becomes a two-day streak — which is why these assert the boundaries rather
 * than a comfortable midday instant.
 */
describe("toWatchDate", () => {
  it("normalises any instant to UTC midnight of its own day", () => {
    const late = new Date("2026-03-14T23:59:59.999Z");
    expect(toWatchDate(late).toISOString()).toBe("2026-03-14T00:00:00.000Z");
  });

  it("keeps the first instant of a day on that day", () => {
    const early = new Date("2026-03-14T00:00:00.000Z");
    expect(toWatchDate(early).toISOString()).toBe("2026-03-14T00:00:00.000Z");
  });

  it("is idempotent", () => {
    const once = toWatchDate(new Date("2026-03-14T17:22:00Z"));
    expect(toWatchDate(once).getTime()).toBe(once.getTime());
  });
});

describe("daysBetween", () => {
  it("counts a single calendar day as one, however close the clock times", () => {
    expect(daysBetween(new Date("2026-03-14T23:59:00Z"), new Date("2026-03-15T00:01:00Z"))).toBe(1);
  });

  it("counts the same calendar day as zero, however far apart the clock times", () => {
    expect(daysBetween(new Date("2026-03-14T00:01:00Z"), new Date("2026-03-14T23:59:00Z"))).toBe(0);
  });

  it("goes negative when the arguments are the wrong way round", () => {
    expect(daysBetween(new Date("2026-03-15T00:00:00Z"), new Date("2026-03-14T00:00:00Z"))).toBe(-1);
  });

  it("crosses a month boundary and a leap day correctly", () => {
    expect(daysBetween(new Date("2028-02-27T12:00:00Z"), new Date("2028-03-01T12:00:00Z"))).toBe(3);
  });
});

describe("addDays / isSameDay / monthKey", () => {
  it("advances by whole days across a year boundary", () => {
    expect(toIsoDate(addDays(new Date("2026-12-31T10:00:00Z"), 1))).toBe("2027-01-01");
  });

  it("treats different times on one day as the same day", () => {
    expect(isSameDay(new Date("2026-05-02T00:00:01Z"), new Date("2026-05-02T23:59:59Z"))).toBe(true);
    expect(isSameDay(new Date("2026-05-02T23:59:59Z"), new Date("2026-05-03T00:00:01Z"))).toBe(false);
  });

  it("zero-pads the month bucket so keys sort lexicographically", () => {
    expect(monthKey(new Date("2026-01-15T00:00:00Z"))).toBe("2026-01");
    expect(monthKey(new Date("2026-11-15T00:00:00Z"))).toBe("2026-11");
    expect(["2026-11", "2026-01"].sort()).toEqual(["2026-01", "2026-11"]);
  });
});
