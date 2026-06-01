import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

// `@adserve/database` marks its postgres client with `server-only` (build-time
// client/server boundary guard). Node/vitest has no react-server condition, so
// the real package throws on import — alias it to a no-op stub here. The
// boundary is enforced by `next build`, not unit tests.
const serverOnlyStub = fileURLToPath(
  new URL("./test-stubs/server-only.ts", import.meta.url)
);

/**
 * Shared vitest base config for all workspace packages. Each package's
 * `vitest.config.ts` should `mergeConfig(sharedConfig, { ... })` so we
 * don't drift on common settings.
 */
export const sharedConfig = defineConfig({
  resolve: {
    alias: { "server-only": serverOnlyStub },
  },
  test: {
    environment: "node",
    // RLS parity (hardening step 1): the test-helpers' privileged `testDb`
    // (fixture seeding + engine tests) connects as the owner/superuser, exactly
    // as prod seeds run as the privileged migrator. The application's own
    // runtime queries connect as the NOBYPASSRLS app role — see apps/web's
    // config, which points DATABASE_URL at adserve_app so RLS actually enforces.
    // CI overrides via the real env vars; locals fall back to the dev DB.
    env: {
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://jamesfoley@localhost:5432/adserve",
    },
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
