import "server-only";

import { z } from "zod";

/**
 * Server-side environment. Parsed once, at first import, and fails loudly at
 * boot rather than at the first request that happens to need a variable.
 *
 * Anything the browser needs must go through `env.client.ts` instead — this
 * module is `server-only` so it can never be pulled into a client bundle.
 */

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

    RATE_LIMIT_DRIVER: z.enum(["memory"]).default("memory"),
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
