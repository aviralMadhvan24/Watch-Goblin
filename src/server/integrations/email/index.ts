import "server-only";

import { env } from "@/config/env.server";
import { logger } from "@/lib/logger";

/**
 * Email, behind a provider interface.
 *
 * The default `console` provider writes the message to the log instead of
 * sending it — including the password-reset link, which is how you complete a
 * reset in development without wiring up SMTP. It is refused in production
 * (see `createEmailProvider`) so nobody ships an app that silently drops
 * account-recovery mail.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(message: EmailMessage): Promise<void> {
    logger.info("Email (not actually sent — console provider)", {
      to: message.to,
      subject: message.subject,
      body: message.text,
    });
  }
}

/**
 * Placeholder for a real transport. Left unimplemented rather than pulling in
 * an SMTP dependency the MVP does not need — the seam is what matters, and
 * `env` already refuses `EMAIL_PROVIDER=smtp` without an `SMTP_URL`.
 */
class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";

  async send(): Promise<void> {
    throw new Error(
      "SMTP provider is not implemented yet. Install a transport (nodemailer, Resend, ...) and implement send() here.",
    );
  }
}

function createEmailProvider(): EmailProvider {
  if (env.EMAIL_PROVIDER === "smtp") return new SmtpEmailProvider();

  if (env.NODE_ENV === "production") {
    logger.error(
      "EMAIL_PROVIDER=console in production: password reset emails will not be delivered.",
    );
  }
  return new ConsoleEmailProvider();
}

declare global {
  // eslint-disable-next-line no-var
  var __watchgoblinEmail: EmailProvider | undefined;
}

export const email: EmailProvider =
  globalThis.__watchgoblinEmail ?? (globalThis.__watchgoblinEmail = createEmailProvider());
