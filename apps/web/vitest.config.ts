import { mergeConfig, defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";
import { sharedConfig } from "../../vitest.shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(
  sharedConfig,
  defineConfig({
    plugins: [react()],
    test: {
      include: [
        "__tests__/**/*.test.ts",
        "__tests__/**/*.test.tsx",
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
      ],
      // RLS parity (hardening step 1). Route tests exercise the app DB client
      // (withTenant / withSuperAdminBypass), which reads DATABASE_URL at module
      // load. Point it at the NOBYPASSRLS `adserve_app` role so RLS ACTUALLY
      // ENFORCES on the app's runtime queries — mirroring prod, where dev's
      // superuser used to bypass RLS silently. Fixtures still seed via the
      // privileged `testDb` (TEST_DATABASE_URL). We use a dedicated
      // TEST_APP_DATABASE_URL (NOT process.env.DATABASE_URL) so a developer's
      // exported superuser DATABASE_URL can't leak in and silently bypass RLS.
      // CI sets TEST_APP_DATABASE_URL to its own app-role connection.
      env: {
        DATABASE_URL:
          process.env.TEST_APP_DATABASE_URL ??
          "postgresql://adserve_app:adserve_app_dev@localhost:5432/adserve",
        TEST_DATABASE_URL:
          process.env.TEST_DATABASE_URL ??
          "postgresql://jamesfoley@localhost:5432/adserve",
      },
    },
    resolve: {
      alias: {
        // Match the `@/` path alias the app uses.
        "@": path.resolve(__dirname, "src"),
      },
    },
  })
);
