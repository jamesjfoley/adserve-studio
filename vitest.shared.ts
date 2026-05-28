import { defineConfig } from "vitest/config";

/**
 * Shared vitest base config for all workspace packages. Each package's
 * `vitest.config.ts` should `mergeConfig(sharedConfig, { ... })` so we
 * don't drift on common settings.
 */
export const sharedConfig = defineConfig({
  test: {
    environment: "node",
    // Tests can write to the database; run them serially per package so we
    // don't get interleaved transactions on the single-connection testDb.
    pool: "forks",
    // vitest 4 moved pool options to top-level under `forks`/`threads`.
    forks: { singleFork: true },
    // Keep individual tests fast; complain at 10s.
    testTimeout: 10_000,
    hookTimeout: 30_000,
    // Don't watch in CI; let the package's `test` script handle the mode.
    watch: false,
    // Globals = false to keep imports explicit. `import { test, expect } from "vitest"`.
    globals: false,
  },
});
