/**
 * Prepares the integration-test database.
 *
 * Idempotent, and safe to run before every test run:
 *   1. creates the database named by TEST_DATABASE_URL if it does not exist
 *   2. applies all migrations to it
 *
 * The docker-compose init script also creates this database, but only on the
 * very first boot of a fresh volume — so anyone who joined after the volume was
 * created, or who runs Postgres some other way, needs this.
 */
import "dotenv/config";

import { execSync } from "node:child_process";

import { Client } from "pg";

function requireTestDatabaseUrl(): URL {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    throw new Error("TEST_DATABASE_URL is not set. Copy it from .env.example into your .env.");
  }
  if (raw === process.env.DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL must differ from DATABASE_URL — the integration suite truncates every table in it.",
    );
  }
  return new URL(raw);
}

async function ensureDatabaseExists(target: URL): Promise<boolean> {
  // Connect to `postgres` rather than the target: you cannot CREATE DATABASE
  // from inside the database you are creating.
  const admin = new URL(target.toString());
  admin.pathname = "/postgres";
  admin.search = "";

  const name = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!name) throw new Error(`TEST_DATABASE_URL has no database name: ${target}`);

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();

  try {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (existing.rowCount && existing.rowCount > 0) return false;

    // Identifier, not a value, so it cannot be a bound parameter. The name
    // comes from the developer's own connection string, and quoting it is
    // enough to keep a hyphen or a capital letter from breaking the statement.
    await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    return true;
  } finally {
    await client.end();
  }
}

async function main() {
  const target = requireTestDatabaseUrl();
  const created = await ensureDatabaseExists(target);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ""));

  console.log(created ? `Created database "${name}".` : `Database "${name}" already exists.`);

  // `migrate deploy` applies committed migrations without prompting and without
  // ever resetting — the right verb for a database a script owns.
  // `execSync` with a constant command string, rather than `execFileSync` with
  // an argument array: on Windows the npx shim is a .cmd file, which Node 20+
  // refuses to spawn without a shell (EINVAL). Nothing user-supplied is
  // interpolated here — the connection string travels in the environment.
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: target.toString() },
  });

  console.log(`\nTest database ready. Run: npm run test:integration`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
