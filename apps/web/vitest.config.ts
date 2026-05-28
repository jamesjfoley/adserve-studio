import { mergeConfig, defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";
import { sharedConfig } from "../../vitest.shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ["__tests__/**/*.test.ts", "src/**/*.test.ts"],
    },
    resolve: {
      alias: {
        // Match the `@/` path alias the app uses.
        "@": path.resolve(__dirname, "src"),
      },
    },
  })
);
