import "server-only";

import { z } from "zod";

/**
 * Server-side environment. Parsed once, at first import, and fails loudly at
 * boot rather than at the first request that happens to need a variable.
 *
 * Anything the browser needs must go through `env.client.ts` instead — this
 * module is `server-only` so it can never be pulled into a client bundle.
 */

/**
 * True while `next build` is compiling.
 *
 * `next build` runs with NODE_ENV=production and imports the app to collect
 * route data, so every production-only rule below would otherwise fire on a
 * developer's machine — and the only way past it would be to feed the build
 * fake credentials for services it never contacts. These rules exist to stop a
 * *serving* process from starting misconfigured; a compile is not that.
 *
 * Next sets this itself (see PHASE_PRODUCTION_BUILD in next/dist), so it cannot
 * be used to slip past the checks at runtime without deliberately forging it.
 */
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

/** A production rule only applies to a process that is about to serve traffic. */
const servingInProduction = (nodeEnv: string) => nodeEnv === "production" && !isBuildPhase;

const booleanish = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    APP_URL: z.url().default("http://localhost:3000"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    TEST_DATABASE_URL: z.string().optional(),

    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
    AUTH_SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
    AUTH_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),

    METADATA_PROVIDER: z.enum(["local", "tmdb"]).default("local"),
    TMDB_API_KEY: z.string().optional(),
    TMDB_API_BASE_URL: z.string().default("https://api.themoviedb.org/3"),
    TMDB_IMAGE_BASE_URL: z.string().default("https://image.tmdb.org/t/p"),

    STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default("./public/uploads"),
    STORAGE_PUBLIC_BASE_URL: z.string().default("/uploads"),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_PUBLIC_BASE_URL: z.string().optional(),

    EMAIL_PROVIDER: z.enum(["console", "smtp"]).default("console"),
    EMAIL_FROM: z.string().default("WatchGoblin <no-reply@watchgoblin.test>"),
    SMTP_URL: z.string().optional(),

    RATE_LIMIT_DRIVER: z.enum(["memory", "postgres"]).default("memory"),
    /** Escape hatch for load tests and seeding; never set this in production. */
    RATE_LIMIT_DISABLED: booleanish.default(false),
  })
  // Cross-field rules: a provider is only selectable if it is configured.
  .refine((v) => v.METADATA_PROVIDER !== "tmdb" || !!v.TMDB_API_KEY, {
    message: "TMDB_API_KEY is required when METADATA_PROVIDER=tmdb",
    path: ["TMDB_API_KEY"],
  })
  .refine(
    (v) =>
      v.STORAGE_PROVIDER !== "s3" ||
      (!!v.S3_BUCKET && !!v.S3_ACCESS_KEY_ID && !!v.S3_SECRET_ACCESS_KEY),
    {
      message:
        "S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when STORAGE_PROVIDER=s3",
      path: ["S3_BUCKET"],
    },
  )
  .refine((v) => v.EMAIL_PROVIDER !== "smtp" || !!v.SMTP_URL, {
    message: "SMTP_URL is required when EMAIL_PROVIDER=smtp",
    path: ["SMTP_URL"],
  })
  // The rules below are production-only, and they are errors rather than
  // warnings on purpose. Each describes a configuration that boots cleanly,
  // passes the health check and then quietly fails a user: a password reset
  // that goes to the server log instead of an inbox, or a rate limiter that is
  // switched off. A process that will not start is a far cheaper failure than
  // one that looks healthy while doing the wrong thing.
  .refine((v) => !servingInProduction(v.NODE_ENV) || v.EMAIL_PROVIDER !== "console", {
    message:
      "EMAIL_PROVIDER=console cannot be used in production — password resets would be written to the log instead of delivered. Set EMAIL_PROVIDER=smtp and SMTP_URL.",
    path: ["EMAIL_PROVIDER"],
  })
  .refine((v) => !servingInProduction(v.NODE_ENV) || !v.RATE_LIMIT_DISABLED, {
    message:
      "RATE_LIMIT_DISABLED cannot be set in production — it turns off login throttling and provider-quota protection.",
    path: ["RATE_LIMIT_DISABLED"],
  });

function load() {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nSee .env.example for the full list.`,
    );
  }

  return Object.freeze(parsed.data);
}

export const env = load();

export type ServerEnv = typeof env;

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
export const isDevelopment = env.NODE_ENV === "development";
