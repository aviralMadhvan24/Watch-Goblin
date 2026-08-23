import "server-only";

import { cookies } from "next/headers";

import { env, isProduction } from "@/config/env.server";

export const SESSION_COOKIE = "wg_session";

/**
 * Cookie policy.
 *
 * `sameSite: "lax"` is the CSRF backstop: the browser will not attach this
 * cookie to a cross-site POST, so a form on evil.example cannot act as the
 * user. Next.js Server Actions additionally verify the Origin header, and
 * route handlers call `assertSameOrigin`, giving two independent defences.
 *
 * `httpOnly` keeps the token away from any script that manages to run on the
 * page, so an XSS bug cannot be escalated into stolen sessions.
 */
function baseOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction,
    path: "/",
  };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { ...baseOptions(), expires: expiresAt });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...baseOptions(), maxAge: 0 });
}

export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export function sessionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + env.AUTH_SESSION_TTL_DAYS * 86_400_000);
}
