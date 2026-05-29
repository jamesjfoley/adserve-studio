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
      // Route-level tests exercise the app DB client (withSuperAdminBypass),
      // which reads DATABASE_URL at module load. Default it to the local dev
      // database when unset so those tests connect to the same DB as the
      // test-helpers' testDb. A real DATABASE_URL/CI value is respected.
      env: {
        DATABASE_URL:
          process.env.DATABASE_URL ??
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
