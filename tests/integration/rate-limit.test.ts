import { describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { PostgresRateLimiter } from "@/lib/rate-limit";

/**
 * The shared driver, tested against a real database because the whole point of
 * it is a single atomic statement — a mock would test the mock and prove
 * nothing about the `ON CONFLICT` branch, which is where the correctness lives.
 */
const limiter = new PostgresRateLimiter();

describe("PostgresRateLimiter", () => {
  it("allows exactly `limit` requests and refuses the next", async () => {
    const rule = { limit: 3, windowMs: 60_000 };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await limiter.consume("test:boundary", rule);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3 - attempt);
    }

    const overBudget = await limiter.consume("test:boundary", rule);
    expect(overBudget.allowed).toBe(false);
    expect(overBudget.remaining).toBe(0);
  });

  it("counts concurrent requests exactly once each", async () => {
    // The reason this is one SQL statement rather than a read then a write:
    // with read-then-write, ten simultaneous callers can all observe the same
    // count and all be allowed through a limit of one.
    const rule = { limit: 4, windowMs: 60_000 };

    const results = await Promise.all(
      Array.from({ length: 10 }, () => limiter.consume("test:concurrent", rule)),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(4);

    const row = await db.rateLimitWindow.findUniqueOrThrow({
      where: { key: "test:concurrent" },
      select: { count: true },
    });
    expect(row.count).toBe(10);
  });

  it("reopens the window once it has expired", async () => {
    const expired = { limit: 1, windowMs: 1 };

    expect((await limiter.consume("test:window", expired)).allowed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The second call finds an expired row and resets it rather than
    // incrementing, which is the `WHEN "resetAt" <= now` branch.
    const reopened = await limiter.consume("test:window", expired);
    expect(reopened.allowed).toBe(true);
    expect(reopened.remaining).toBe(0);
  });

  it("does not reopen the window early", async () => {
    const rule = { limit: 1, windowMs: 60_000 };

    await limiter.consume("test:early", rule);
    expect((await limiter.consume("test:early", rule)).allowed).toBe(false);
  });

  it("keeps separate budgets per key", async () => {
    const rule = { limit: 1, windowMs: 60_000 };

    expect((await limiter.consume("test:userA", rule)).allowed).toBe(true);
    expect((await limiter.consume("test:userB", rule)).allowed).toBe(true);
  });

  it("forgets a key on reset", async () => {
    const rule = { limit: 1, windowMs: 60_000 };

    await limiter.consume("test:manual-reset", rule);
    expect((await limiter.consume("test:manual-reset", rule)).allowed).toBe(false);

    await limiter.reset("test:manual-reset");
    expect((await limiter.consume("test:manual-reset", rule)).allowed).toBe(true);
  });

  it("reports a reset time inside the window", async () => {
    const before = Date.now();
    const result = await limiter.consume("test:reset-at", { limit: 5, windowMs: 60_000 });

    expect(result.resetAt).toBeGreaterThanOrEqual(before);
    expect(result.resetAt).toBeLessThanOrEqual(before + 60_000 + 1_000);
  });
});
