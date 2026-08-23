import "server-only";

import { env } from "@/config/env.server";
import { errors } from "@/lib/errors";

/**
 * Rate limiting, behind an interface.
 *
 * The default driver is an in-process fixed-window counter. That is honest
 * about what it is: correct for a single node, resets on deploy, and useless
 * across a horizontally scaled fleet. It exists so every sensitive route is
 * *already wired* to a limiter — swapping in a shared store later is one class
 * implementing `RateLimiter` and one line in `createLimiter`, with no call-site
 * changes anywhere.
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

declare global {
  // eslint-disable-next-line no-var
  var __watchgoblinRateLimiter: RateLimiter | undefined;
}

function createLimiter(): RateLimiter {
  switch (env.RATE_LIMIT_DRIVER) {
    case "memory":
    default:
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

function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)} minutes`;
}
