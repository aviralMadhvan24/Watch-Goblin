import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import type { Role } from "@/generated/prisma/enums";
import { generateToken, hashToken } from "@/lib/crypto";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { readSessionCookie, sessionExpiry, setSessionCookie, clearSessionCookie } from "./cookies";

/**
 * Session resolution.
 *
 * Sessions are database-backed rather than JWT-based on purpose: this product
 * needs to revoke access immediately (a ban, a password change, "log out
 * everywhere"), and a stateless token cannot do that without a blocklist,
 * which is a session table wearing a disguise.
 *
 * Only the SHA-256 hash of the token is stored, so the table is useless to
 * anyone who reads it.
 */

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  role: Role;
  displayName: string;
  avatarUrl: string | null;
  accentColor: string;
  humorEnabled: boolean;
  level: number;
  xpTotal: number;
}

export interface Session {
  id: string;
  user: SessionUser;
  expiresAt: Date;
}

/** Refresh the DB expiry at most once a day rather than on every request. */
const SLIDING_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves the current session, or null.
 *
 * Wrapped in React `cache` so a page that checks auth in the layout, the page
 * and three components still performs exactly one query per request.
 */
export const getOptionalSession = cache(async (): Promise<Session | null> => {
  const token = await readSessionCookie();
  if (!token) return null;

  const record = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      lastUsedAt: true,
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          isBanned: true,
          profile: {
            select: {
              displayName: true,
              avatarUrl: true,
              accentColor: true,
              humorEnabled: true,
            },
          },
          stats: { select: { level: true, xpTotal: true } },
        },
      },
    },
  });

  if (!record) return null;

  if (record.expiresAt <= new Date()) {
    // Expired: clean up eagerly so the table does not accumulate dead rows.
    await db.session.delete({ where: { id: record.id } }).catch(() => undefined);
    return null;
  }

  // A ban takes effect on the very next request, without waiting for logout.
  if (record.user.isBanned) return null;

  void slideExpiry(record.id, record.lastUsedAt);

  return {
    id: record.id,
    expiresAt: record.expiresAt,
    user: {
      id: record.user.id,
      username: record.user.username,
      email: record.user.email,
      role: record.user.role,
      displayName: record.user.profile?.displayName ?? record.user.username,
      avatarUrl: record.user.profile?.avatarUrl ?? null,
      accentColor: record.user.profile?.accentColor ?? "#8b5cf6",
      humorEnabled: record.user.profile?.humorEnabled ?? true,
      level: record.user.stats?.level ?? 1,
      xpTotal: record.user.stats?.xpTotal ?? 0,
    },
  };
});

/**
 * Extends a session that is actively in use. Fire-and-forget: a failed slide
 * is not worth failing a page render over, and the session is still valid.
 */
async function slideExpiry(sessionId: string, lastUsedAt: Date) {
  if (Date.now() - lastUsedAt.getTime() < SLIDING_REFRESH_THRESHOLD_MS) return;

  try {
    await db.session.update({
      where: { id: sessionId },
      data: { lastUsedAt: new Date(), expiresAt: sessionExpiry() },
    });
  } catch (error) {
    logger.warn("Failed to slide session expiry", { sessionId, error: String(error) });
  }
}

/** For server components: send unauthenticated visitors to the login page. */
export async function requireSession(returnTo?: string): Promise<Session> {
  const session = await getOptionalSession();
  if (!session) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login";
    redirect(target);
  }
  return session;
}

/** For server actions and route handlers: throw rather than redirect. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getOptionalSession();
  if (!session) throw errors.unauthenticated();
  return session.user;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) throw errors.forbidden();
  return user;
}

/** Issues a new session and sets the cookie. Called after login and register. */
export async function createSession(userId: string): Promise<void> {
  const token = generateToken();
  const expiresAt = sessionExpiry();

  const headerList = await headers();

  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: headerList.get("user-agent")?.slice(0, 255) ?? null,
      ipAddress: getClientIp(headerList),
    },
  });

  await setSessionCookie(token, expiresAt);
}

export async function destroyCurrentSession(): Promise<void> {
  const token = await readSessionCookie();
  await clearSessionCookie();
  if (!token) return;

  await db.session
    .deleteMany({ where: { tokenHash: hashToken(token) } })
    .catch((error) => logger.warn("Failed to delete session row", { error: String(error) }));
}

/** Used when a password changes: every other device is logged out. */
export async function destroyAllSessionsForUser(
  userId: string,
  options?: { exceptTokenHash?: string },
): Promise<void> {
  await db.session.deleteMany({
    where: {
      userId,
      ...(options?.exceptTokenHash ? { tokenHash: { not: options.exceptTokenHash } } : {}),
    },
  });
}

/**
 * Best-effort client IP. Trusts `x-forwarded-for` because the app is expected
 * to sit behind a proxy that sets it; it is only used for rate-limit keys and
 * session auditing, never for authorisation.
 */
export function getClientIp(headerList: Headers): string {
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim().slice(0, 45);
  return headerList.get("x-real-ip")?.slice(0, 45) ?? "unknown";
}

/** Rate-limit identity: the user when known, otherwise the caller's IP. */
export async function rateLimitIdentity(userId?: string | null): Promise<string> {
  if (userId) return `user:${userId}`;
  const headerList = await headers();
  return `ip:${getClientIp(headerList)}`;
}
