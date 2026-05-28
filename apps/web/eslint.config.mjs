import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "path";
import { fileURLToPath } from "url";

// FlatCompat is required because eslint-config-next still ships legacy
// .eslintrc-format CJS configs (with `extends:` keys), not flat configs.
// This wraps them so we can use them under ESLint 9's flat config.
//
// The two presets together match what `next lint` was applying by
// default with the Strict template:
//   - next/core-web-vitals → @next/next core rules + React + React-hooks
//   - next/typescript      → @typescript-eslint/recommended + light tweaks
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
