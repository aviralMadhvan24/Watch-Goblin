import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isAppError } from "@/lib/errors";
import { checkRateLimit, enforceRateLimit, rateLimiter, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * The limiter is a fixed-window counter, so what matters is the boundary: the
 * request that exactly hits the limit must pass, the next must not, and the
 * window must actually reopen. Fake timers are used because the real windows
 * are minutes to hours long.
 *
 * Keys are namespaced per test so the shared singleton cannot leak state
 * between them.
 */
describe("rateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows exactly `limit` requests and refuses the next", async () => {
    const rule = { limit: 3, windowMs: 60_000 };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await rateLimiter.consume("test:boundary", rule);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3 - attempt);
    }

    const overBudget = await rateLimiter.consume("test:boundary", rule);
    expect(overBudget.allowed).toBe(false);
    expect(overBudget.remaining).toBe(0);
  });

  it("reopens the window once it expires", async () => {
    const rule = { limit: 1, windowMs: 60_000 };

    expect((await rateLimiter.consume("test:window", rule)).allowed).toBe(true);
    expect((await rateLimiter.consume("test:window", rule)).allowed).toBe(false);

    vi.advanceTimersByTime(60_001);

    expect((await rateLimiter.consume("test:window", rule)).allowed).toBe(true);
  });

  it("does not reopen the window early", async () => {
    const rule = { limit: 1, windowMs: 60_000 };

    await rateLimiter.consume("test:early", rule);
    vi.advanceTimersByTime(59_000);

    expect((await rateLimiter.consume("test:early", rule)).allowed).toBe(false);
  });

  it("keeps separate budgets per key", async () => {
    const rule = { limit: 1, windowMs: 60_000 };

    expect((await rateLimiter.consume("test:userA", rule)).allowed).toBe(true);
    expect((await rateLimiter.consume("test:userB", rule)).allowed).toBe(true);
  });

  it("reports a reset time inside the window", async () => {
    const rule = { limit: 5, windowMs: 60_000 };
    const result = await rateLimiter.consume("test:reset", rule);

    expect(result.resetAt).toBeGreaterThan(Date.now());
    expect(result.resetAt).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("forgets a key on reset", async () => {
    const rule = { limit: 1, windowMs: 60_000 };

    await rateLimiter.consume("test:manual-reset", rule);
    expect((await rateLimiter.consume("test:manual-reset", rule)).allowed).toBe(false);

    await rateLimiter.reset("test:manual-reset");
    expect((await rateLimiter.consume("test:manual-reset", rule)).allowed).toBe(true);
  });
});

describe("enforceRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws a user-facing RATE_LIMITED error once over budget", async () => {
    const identity = "user:enforce-test";
    const { limit } = RATE_LIMITS.login;

    for (let attempt = 0; attempt < limit; attempt += 1) {
      await expect(enforceRateLimit("login", identity)).resolves.toBeUndefined();
    }

    await expect(enforceRateLimit("login", identity)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "RATE_LIMITED",
    );
  });

  it("uses the caller's message when one is supplied", async () => {
    const identity = "user:enforce-message";
    const { limit } = RATE_LIMITS.register;

    for (let attempt = 0; attempt < limit; attempt += 1) {
      await enforceRateLimit("register", identity, "Nope.");
    }

    await expect(enforceRateLimit("register", identity, "Nope.")).rejects.toThrow("Nope.");
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the verdict instead of throwing, so a read path can degrade", async () => {
    const identity = "ip:check-test";
    const { limit } = RATE_LIMITS.search;

    for (let attempt = 0; attempt < limit; attempt += 1) {
      expect((await checkRateLimit("search", identity)).allowed).toBe(true);
    }

    const overBudget = await checkRateLimit("search", identity);
    expect(overBudget.allowed).toBe(false);
    expect(overBudget.resetAt).toBeGreaterThan(Date.now());
  });
});
