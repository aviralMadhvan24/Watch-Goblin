/**
 * Environment for unit tests.
 *
 * `config/env.server` parses `process.env` at first import and throws on a
 * missing variable, so the values have to exist before any module under test is
 * loaded — which is exactly what a setup file guarantees.
 *
 * Real values from `.env` win; the fallbacks below only fill gaps so the suite
 * runs on a machine (or in CI) that has no `.env` at all. Nothing here touches
 * a database: unit tests never open a connection.
 */
import "dotenv/config";

// `@types/node` types NODE_ENV as readonly; the cast is the standard way to
// set it from a setup file, which is the only place it can be set in time.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.AUTH_SECRET ??= "test-secret-that-is-at-least-32-characters-long";
process.env.DATABASE_URL ??= "postgresql://watchgoblin:watchgoblin@localhost:5442/watchgoblin_test";
process.env.APP_URL ??= "http://localhost:3000";
process.env.METADATA_PROVIDER ??= "local";
process.env.EMAIL_PROVIDER ??= "console";
process.env.STORAGE_PROVIDER ??= "local";

// Forced off rather than left to `.env`: the rate-limiter tests assert real
// window behaviour, and a developer with the escape hatch enabled locally
// would otherwise see them fail for reasons unrelated to their change.
process.env.RATE_LIMIT_DISABLED = "false";
