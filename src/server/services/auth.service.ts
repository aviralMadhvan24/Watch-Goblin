import "server-only";

import { env } from "@/config/env.server";
import { db } from "@/db/client";
import {
  changePasswordSchema,
  confirmPasswordResetSchema,
  loginSchema,
  registerSchema,
  requestPasswordResetSchema,
} from "@/features/auth/schemas";
import {
  fakePasswordVerification,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "@/lib/crypto";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  createSession,
  destroyAllSessionsForUser,
  destroyCurrentSession,
  rateLimitIdentity,
} from "@/server/auth/session";
import { email } from "@/server/integrations/email";
import { statsService } from "@/server/services/stats.service";

/**
 * Account lifecycle.
 *
 * Two rules run through everything here:
 *
 *  1. **Never confirm what exists.** Registration, login and password reset all
 *     return the same shape whether or not the account exists, and login burns
 *     an equivalent amount of CPU on a missing email so response timing does
 *     not leak the answer either. Registration is the one place we cannot fully
 *     hide it — the username has to be unique and the user must be told — so
 *     the *email* collision is reported generically while the *username*
 *     collision is explicit.
 *
 *  2. **A password change ends every other session.** That is what makes
 *     "someone is in my account" recoverable.
 */

export const authService = {
  async register(input: unknown) {
    const parsed = registerSchema.safeParse(input);
    if (!parsed.success) throw toValidationError(parsed.error);

    const { email: address, username, password, displayName } = parsed.data;

    await enforceRateLimit("register", await rateLimitIdentity());

    const existing = await db.user.findFirst({
      where: { OR: [{ email: address }, { username }] },
      select: { email: true, username: true },
    });

    if (existing?.username === username) {
      throw errors.conflict("That username is taken. Someone beat you to it.");
    }
    if (existing) {
      // Do not confirm that this email has an account.
      throw errors.conflict(
        "We could not create that account. If you already have one, try logging in or resetting your password.",
      );
    }

    const passwordHash = await hashPassword(password);

    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: address,
          username,
          passwordHash,
          profile: {
            create: { displayName: displayName?.trim() || username },
          },
          stats: { create: {} },
          streak: { create: {} },
        },
        select: { id: true, username: true },
      });

      // Resolve the starting rank so a brand-new profile is never rank-less.
      await statsService.refreshRank(tx, created.id, 0);
      return created;
    });

    await createSession(user.id);
    logger.info("User registered", { userId: user.id, username: user.username });

    return { userId: user.id, username: user.username };
  },

  async login(input: unknown) {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) throw toValidationError(parsed.error);

    const { email: address, password } = parsed.data;

    // Keyed by IP *and* by the email being tried, so one attacker cannot lock
    // out an account by hammering it, and cannot dodge the limit by rotating
    // targets from a single address either.
    await enforceRateLimit("login", await rateLimitIdentity());
    await enforceRateLimit("login", `email:${address}`);

    const user = await db.user.findUnique({
      where: { email: address },
      select: { id: true, passwordHash: true, isBanned: true, banReason: true },
    });

    if (!user) {
      // Spend the same time we would have spent on a real comparison.
      await fakePasswordVerification();
      throw errors.validation("That email and password do not match.");
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw errors.validation("That email and password do not match.");
    }

    if (user.isBanned) {
      throw errors.forbidden(
        user.banReason
          ? `This account is suspended: ${user.banReason}`
          : "This account is suspended.",
      );
    }

    await createSession(user.id);
    logger.info("User logged in", { userId: user.id });

    return { userId: user.id };
  },

  async logout() {
    await destroyCurrentSession();
  },

  /**
   * Always resolves successfully, whether or not the address is registered.
   * The response must not tell an enumerator which emails have accounts.
   */
  async requestPasswordReset(input: unknown) {
    const parsed = requestPasswordResetSchema.safeParse(input);
    if (!parsed.success) throw toValidationError(parsed.error);

    const { email: address } = parsed.data;

    await enforceRateLimit("passwordResetRequest", await rateLimitIdentity());
    await enforceRateLimit("passwordResetRequest", `email:${address}`);

    const user = await db.user.findUnique({
      where: { email: address },
      select: { id: true, username: true },
    });

    if (user) {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + env.AUTH_RESET_TOKEN_TTL_MINUTES * 60_000);

      await db.$transaction(async (tx) => {
        // Only one live reset link at a time.
        await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
        await tx.passwordResetToken.create({
          data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
        });
      });

      const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;

      await email.send({
        to: address,
        subject: "Reset your WatchGoblin password",
        text: [
          `Hi @${user.username},`,
          "",
          "Someone asked to reset your WatchGoblin password. If that was you, open this link:",
          link,
          "",
          `The link stops working in ${env.AUTH_RESET_TOKEN_TTL_MINUTES} minutes.`,
          "If it was not you, ignore this email — nothing has changed.",
        ].join("\n"),
      });

      logger.info("Password reset requested", { userId: user.id });
    }

    return { ok: true as const };
  },

  async confirmPasswordReset(input: unknown) {
    const parsed = confirmPasswordResetSchema.safeParse(input);
    if (!parsed.success) throw toValidationError(parsed.error);

    const { token, password } = parsed.data;

    await enforceRateLimit("passwordResetConfirm", await rateLimitIdentity());

    const record = await db.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });

    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw errors.validation("That reset link has expired or already been used.");
    }

    const passwordHash = await hashPassword(password);

    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await tx.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      // Any other outstanding links for this account are now void.
      await tx.passwordResetToken.deleteMany({
        where: { userId: record.userId, usedAt: null },
      });
    });

    // Whoever triggered the reset is presumed to be recovering a compromised
    // account: every existing session dies, including the attacker's.
    await destroyAllSessionsForUser(record.userId);
    await createSession(record.userId);

    logger.info("Password reset completed", { userId: record.userId });
    return { ok: true as const };
  },

  async changePassword(userId: string, input: unknown) {
    const parsed = changePasswordSchema.safeParse(input);
    if (!parsed.success) throw toValidationError(parsed.error);

    const { currentPassword, newPassword } = parsed.data;

    await enforceRateLimit("changePassword", `user:${userId}`);

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) throw errors.notFound("Account not found.");

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      throw errors.validation("That is not your current password.", {
        currentPassword: ["That is not your current password."],
      });
    }

    const passwordHash = await hashPassword(newPassword);
    await db.user.update({ where: { id: userId }, data: { passwordHash } });

    // Log out everywhere, then re-issue for the device that made the change.
    await destroyAllSessionsForUser(userId);
    await createSession(userId);

    logger.info("Password changed", { userId });
    return { ok: true as const };
  },
};

/** Flattens a Zod error into an `AppError` carrying per-field messages. */
function toValidationError(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (fieldErrors[key] ??= []).push(issue.message);
  }
  const first = error.issues[0]?.message ?? "Please check the highlighted fields.";
  return errors.validation(first, fieldErrors);
}

export { toValidationError };
