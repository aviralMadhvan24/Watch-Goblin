import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Integration tests: real Postgres, real Prisma, no mocks.
 *
 * These exist because the parts of this codebase most worth protecting —
 * progress derivation, XP dedupe, import idempotency — are defined by their
 * interaction with the database. Mocking Prisma would test the mock.
 *
 * Run single-threaded and single-forked. Every test file truncates the database
 * in `beforeEach`, so two files running at once would delete each other's
 * fixtures mid-assertion.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/setup/integration.ts"],
    pool: "forks",
    // Vitest 4 configures worker counts at the top level. `fileParallelism`
    // keeps one test file in flight at a time and `maxWorkers` pins that to a
    // single process, so there is exactly one Prisma pool and one truncate
    // happening at any moment.
    fileParallelism: false,
    maxWorkers: 1,
    // A cold Prisma connection plus a truncate is slower than the 5s default,
    // and a timeout here reads as a flake rather than the setup cost it is.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
