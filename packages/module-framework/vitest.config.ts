import { mergeConfig, defineConfig } from "vitest/config";
import { sharedConfig } from "../../vitest.shared";

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts", "__tests__/**/*.test.ts"],
    },
  })
);
