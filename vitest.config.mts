import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Unit tests: pure logic, no database, no network.
 *
 * Anything that needs real rows lives in `tests/integration` and runs under
 * `vitest.integration.config.ts` instead, because those tests need a database
 * to truncate and must not run concurrently with each other.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // See the stub for why this cannot just resolve to the real package.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["./tests/setup/env.ts"],
  },
});
