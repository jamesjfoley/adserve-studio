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

// Local rule: forbid importing server-only modules (the postgres driver, the
// @adserve/database entry) from a Client Component ("use client"). This is the
// fast lint-time guard for the client/server boundary class that broke prod 3x;
// the `server-only` marker on those modules is the for-sure build-time backstop.
// Type-only imports are erased by the bundler, so they're allowed.
const SERVER_ONLY_MODULES = new Set(["postgres", "@adserve/database"]);
const boundaryPlugin = {
  rules: {
    "no-server-in-client": {
      meta: {
        type: "problem",
        docs: {
          description:
            'Disallow server-only imports (postgres / @adserve/database) in "use client" files',
        },
        schema: [],
      },
      create(context) {
        const sc = context.sourceCode ?? context.getSourceCode();
        // A "use client" directive is a leading string-literal statement.
        let isClient = false;
        for (const stmt of sc.ast.body) {
          if (
            stmt.type === "ExpressionStatement" &&
            stmt.expression?.type === "Literal" &&
            typeof stmt.expression.value === "string"
          ) {
            if (stmt.expression.value === "use client") {
              isClient = true;
              break;
            }
            continue; // another directive (e.g. "use strict") — keep scanning
          }
          break; // first non-directive statement → directives are done
        }
        if (!isClient) return {};
        return {
          ImportDeclaration(node) {
            if (node.importKind === "type") return; // erased at build
            const src = node.source.value;
            if (typeof src !== "string" || !SERVER_ONLY_MODULES.has(src)) return;
            // Allow if every specifier is type-only (`import { type X }`).
            const allType =
              node.specifiers.length > 0 &&
              node.specifiers.every((s) => s.importKind === "type");
            if (allType) return;
            context.report({
              node,
              message: `Server-only module "${src}" must not be imported in a Client Component ("use client"). Use a server component or a client-safe entrypoint (e.g. @adserve/module-framework/client).`,
            });
          },
        };
      },
    },
  },
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    plugins: { boundary: boundaryPlugin },
    rules: { "boundary/no-server-in-client": "error" },
  },
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
