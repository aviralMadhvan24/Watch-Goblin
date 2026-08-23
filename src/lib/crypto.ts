import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import bcrypt from "bcryptjs";

/**
 * Password and token primitives.
 *
 * Two different hashes on purpose:
 *  - Passwords use bcrypt. They are low-entropy and attacker-guessable, so the
 *    hash must be deliberately slow.
 *  - Session and reset tokens use SHA-256. They are 256 bits of CSPRNG output,
 *    so brute force is off the table and a fast hash is the right choice — it
 *    keeps session lookup a single indexed read per request while still
 *    ensuring a database dump contains no usable tokens.
 */

const BCRYPT_COST = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

/**
 * Burns roughly the same time as a real bcrypt comparison. Called on the login
 * path when the email does not exist, so response timing does not reveal which
 * accounts are registered.
 */
export async function fakePasswordVerification(): Promise<void> {
  await bcrypt.compare(
    "watchgoblin-timing-equaliser",
    "$2b$12$C6UzMDM.H6dfI/f/IKcEe.z9dc9dOwVxYrHb0aWtGeLGN9pUlvKfW",
  );
}

/** 256 bits of CSPRNG output, base64url encoded. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time string comparison for anything secret-shaped. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
