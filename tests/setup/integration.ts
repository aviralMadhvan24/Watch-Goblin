/**
 * Environment and per-test isolation for the integration suite.
 *
 * Two things have to happen before any application module is imported:
 * `config/env.server` parses `process.env` once at first import, and
 * `db/client` builds its connection pool from `DATABASE_URL` at first import.
 * Both are module-load side effects, so pointing them at the test database has
 * to happen here rather than inside a test.
 */
import "dotenv/config";

import { afterAll, beforeEach } from "vitest";

// `@types/node` types NODE_ENV as readonly; the cast is the standard way to
// set it from a setup file, which is the only place it can be set in time.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.AUTH_SECRET ??= "test-secret-that-is-at-least-32-characters-long";
process.env.APP_URL ??= "http://localhost:3000";
process.env.METADATA_PROVIDER ??= "local";
process.env.EMAIL_PROVIDER ??= "console";
process.env.STORAGE_PROVIDER ??= "local";

/**
 * The single most important line in this file. `TEST_DATABASE_URL` names a
 * database that gets truncated between every test; without this assignment the
 * suite would truncate the development database instead.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required to run integration tests. Run `npm run test:db:setup` first.",
  );
}
if (testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL must differ from DATABASE_URL — these tests truncate every table.",
  );
}
process.env.DATABASE_URL = testDatabaseUrl;

// The rate limiter is a per-process fixed window, and a test that marks 400
// episodes would trip `trackEpisode` on run 2 for reasons that have nothing to
// do with what it is asserting. This is the escape hatch the env schema
// documents, and it is rejected outright in production.
process.env.RATE_LIMIT_DISABLED = "true";

const { db } = await import("@/db/client");

/**
 * Truncates every application table.
 *
 * Read from `information_schema` rather than hard-coded, so a new model added
 * to the schema is covered without anyone remembering to update this list.
 * `_prisma_migrations` is excluded — dropping it would make Prisma believe the
 * database is unmigrated. `CASCADE` handles the foreign-key ordering and
 * `RESTART IDENTITY` resets sequences so ids do not leak between tests.
 */
export async function resetDatabase(): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const list = tables.map((row) => `"public"."${row.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

beforeEach(resetDatabase);

afterAll(async () => {
  await db.$disconnect();
});
