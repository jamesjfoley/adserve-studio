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
    },
    resolve: {
      alias: {
        // Match the `@/` path alias the app uses.
        "@": path.resolve(__dirname, "src"),
      },
    },
  })
);
