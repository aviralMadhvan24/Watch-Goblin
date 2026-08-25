import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

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
 * Real SMTP delivery.
 *
 * Configured entirely from `SMTP_URL`, which `env.server` already requires
 * whenever `EMAIL_PROVIDER=smtp` — so host, port, credentials and TLS all
 * travel as one secret rather than five environment variables that can
 * disagree with each other.
 *
 * The transport is created lazily and then reused, so a password reset does not
 * pay for a fresh TCP and TLS handshake. Add `?pool=true` to the URL to keep a
 * pool of connections open as well — nodemailer reads its options from the URL
 * query string, which is why none of them appear here as code.
 */
class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";

  private transporter: Transporter | null = null;

  private transport(): Transporter {
    if (this.transporter) return this.transporter;

    // `env.server` refuses `EMAIL_PROVIDER=smtp` without an `SMTP_URL`, so this
    // is unreachable — but the schema enforces it with a cross-field refine,
    // which TypeScript cannot narrow from. Asserting here beats a non-null
    // assertion that would silently hand nodemailer `undefined`.
    const url = env.SMTP_URL;
    if (!url) throw new Error("SMTP_URL is required when EMAIL_PROVIDER=smtp.");

    this.transporter = nodemailer.createTransport(url);
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      await this.transport().sendMail({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
    } catch (error) {
      // The recipient address is logged, the body is not: these messages carry
      // password-reset links, and a link in a log is a link an operator can use.
      logger.error("SMTP delivery failed", error, {
        to: message.to,
        subject: message.subject,
      });
      throw error;
    }
  }
}

function createEmailProvider(): EmailProvider {
  if (env.EMAIL_PROVIDER === "smtp") return new SmtpEmailProvider();

  // `EMAIL_PROVIDER=console` in production is rejected by `env.server` before
  // this runs, so reaching here means development or test.
  return new ConsoleEmailProvider();
}

declare global {
  var __watchgoblinEmail: EmailProvider | undefined;
}

export const email: EmailProvider =
  globalThis.__watchgoblinEmail ?? (globalThis.__watchgoblinEmail = createEmailProvider());
