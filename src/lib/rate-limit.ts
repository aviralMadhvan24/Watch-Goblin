import "server-only";

import { env } from "@/config/env.server";
import { db } from "@/db/client";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Rate limiting, behind an interface.
 *
 * Two drivers, chosen by `RATE_LIMIT_DRIVER`:
 *
 *   memory    (default) an in-process fixed-window counter. Correct for a
 *             single node, resets on deploy, and useless across a horizontally
 *             scaled fleet — every instance gets its own budget, so the
 *             effective limit multiplies by the number of instances.
 *   postgres  the same fixed window, held in a shared table. One upsert per
 *             checked request, no infrastructure beyond the database already in
 *             use, and correct behind a load balancer.
 *
 * `memory` stays the default because it is free and most deployments are one
 * box. Switch to `postgres` before running a second instance — it is one
 * environment variable, and no call site changes.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Unix ms at which the current window resets. */
  resetAt: number;
}

export interface RateLimiter {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/**
 * Named rules, so limits are reviewable in one place rather than scattered as
 * magic numbers across actions.
 */
export const RATE_LIMITS = {
  login: { limit: 8, windowMs: 15 * 60_000 },
  register: { limit: 5, windowMs: 60 * 60_000 },
  passwordResetRequest: { limit: 4, windowMs: 60 * 60_000 },
  passwordResetConfirm: { limit: 10, windowMs: 60 * 60_000 },
  changePassword: { limit: 10, windowMs: 60 * 60_000 },
  /** Generous: this is the core loop and power users click it constantly. */
  trackEpisode: { limit: 300, windowMs: 60_000 },
  updateLibrary: { limit: 120, windowMs: 60_000 },
  writeReview: { limit: 20, windowMs: 60 * 60_000 },
  comment: { limit: 40, windowMs: 60 * 60_000 },
  like: { limit: 200, windowMs: 60_000 },
  follow: { limit: 100, windowMs: 60 * 60_000 },
  search: { limit: 120, windowMs: 60_000 },
  upload: { limit: 20, windowMs: 60 * 60_000 },
  updateProfile: { limit: 30, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

interface Window {
  count: number;
  resetAt: number;
}

class MemoryRateLimiter implements RateLimiter {
  private windows = new Map<string, Window>();
  private lastSweep = 0;

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const now = Date.now();
    this.sweep(now);

    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + rule.windowMs;
      this.windows.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: rule.limit - 1, resetAt };
    }

    existing.count += 1;
    return {
      allowed: existing.count <= rule.limit,
      remaining: Math.max(0, rule.limit - existing.count),
      resetAt: existing.resetAt,
    };
  }

  async reset(key: string): Promise<void> {
    this.windows.delete(key);
  }

  /** Drops expired windows at most once a minute so the map cannot grow forever. */
  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

/**
 * Shared fixed-window counter, held in Postgres.
 *
 * The whole check is one statement. That matters: read-then-write would let two
 * concurrent requests both observe "1 used" and both proceed, which is exactly
 * the race a limiter exists to prevent. `ON CONFLICT DO UPDATE` makes the read,
 * the expiry decision and the increment a single atomic row operation, so the
 * count is correct no matter how many instances hit the same key at once.
 */
export class PostgresRateLimiter implements RateLimiter {
  private lastSweep = 0;

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const now = new Date();
    const resetAt = new Date(now.getTime() + rule.windowMs);

    void this.sweep(now);

    try {
      const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>`
        INSERT INTO "rate_limit_windows" ("key", "count", "resetAt")
        VALUES (${key}, 1, ${resetAt})
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE
            WHEN "rate_limit_windows"."resetAt" <= ${now} THEN 1
            ELSE "rate_limit_windows"."count" + 1
          END,
          "resetAt" = CASE
            WHEN "rate_limit_windows"."resetAt" <= ${now} THEN ${resetAt}
            ELSE "rate_limit_windows"."resetAt"
          END
        RETURNING "count", "resetAt"
      `;

      const row = rows[0];
      if (!row) throw new Error("rate limit upsert returned no row");

      return {
        allowed: row.count <= rule.limit,
        remaining: Math.max(0, rule.limit - row.count),
        resetAt: row.resetAt.getTime(),
      };
    } catch (error) {
      // Fail open. A limiter that takes the site down when the database
      // hiccups has traded a throttling problem for an outage; the throttle is
      // a guard rail, not a correctness requirement.
      logger.error("Rate limit check failed; allowing the request", error, { key });
      return { allowed: true, remaining: rule.limit, resetAt: resetAt.getTime() };
    }
  }

  async reset(key: string): Promise<void> {
    await db.rateLimitWindow.deleteMany({ where: { key } });
  }

  /** Clears expired windows at most once a minute so the table stays small. */
  private async sweep(now: Date): Promise<void> {
    if (now.getTime() - this.lastSweep < 60_000) return;
    this.lastSweep = now.getTime();

    try {
      await db.rateLimitWindow.deleteMany({ where: { resetAt: { lte: now } } });
    } catch (error) {
      // Housekeeping only — a failed sweep costs disk, never correctness.
      logger.warn("Rate limit sweep failed", { error: String(error) });
    }
  }
}

declare global {
  var __watchgoblinRateLimiter: RateLimiter | undefined;
}

function createLimiter(): RateLimiter {
  switch (env.RATE_LIMIT_DRIVER) {
    case "postgres":
      return new PostgresRateLimiter();
    case "memory":
    default:
      if (env.NODE_ENV === "production") {
        logger.warn(
          "RATE_LIMIT_DRIVER=memory in production: limits are per-process, so they multiply by the number of instances. Use RATE_LIMIT_DRIVER=postgres when running more than one.",
        );
      }
      return new MemoryRateLimiter();
  }
}

export const rateLimiter: RateLimiter =
  globalThis.__watchgoblinRateLimiter ?? (globalThis.__watchgoblinRateLimiter = createLimiter());

/**
 * Consumes one unit and throws a friendly `AppError` when the caller is over
 * budget. `identifier` should be the most specific stable thing available —
 * a user id when signed in, otherwise the client IP.
 */
export async function enforceRateLimit(
  name: RateLimitName,
  identifier: string,
  message?: string,
): Promise<void> {
  if (env.RATE_LIMIT_DISABLED) return;

  const result = await rateLimiter.consume(`${name}:${identifier}`, RATE_LIMITS[name]);
  if (!result.allowed) {
    const seconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    throw errors.rateLimited(
      message ?? `Too many attempts. Try again in ${formatRetryAfter(seconds)}.`,
    );
  }
}

/**
 * Consumes one unit and reports the verdict instead of throwing.
 *
 * For read paths rendered inside a Suspense boundary, where throwing would
 * take down the surrounding page to punish a request that was merely too
 * frequent. The caller degrades — skips the expensive work, renders a notice —
 * rather than failing. Write paths should keep using `enforceRateLimit`, whose
 * throw is caught by the server-action wrapper and shown as an error.
 */
export async function checkRateLimit(
  name: RateLimitName,
  identifier: string,
): Promise<RateLimitResult> {
  if (env.RATE_LIMIT_DISABLED) {
    return { allowed: true, remaining: RATE_LIMITS[name].limit, resetAt: Date.now() };
  }

  return rateLimiter.consume(`${name}:${identifier}`, RATE_LIMITS[name]);
}

/** Human-readable "try again in ..." for a `RateLimitResult`. */
export function retryAfterLabel(result: RateLimitResult): string {
  return formatRetryAfter(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)));
}

function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)} minutes`;
}
