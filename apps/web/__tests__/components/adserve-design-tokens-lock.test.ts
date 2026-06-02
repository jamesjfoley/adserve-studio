import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * adserve-design token value-lock guard.
 *
 * The `adserve-design` project skill (.claude/skills/adserve-design/SKILL.md)
 * documents the design-system token catalogue as a fenced block that is meant to
 * be a VERBATIM copy of the `--name: value;` declarations in globals.css. This
 * guard pins names AND values, one-directionally (skill ⊆ globals.css): every
 * `--token: value;` declaration in the skill's catalogue block must appear in
 * apps/web/src/app/globals.css. If a token is renamed, revalued, or removed in
 * globals.css without the skill being updated to match, this test fails — the
 * same spirit as the cost.ts price-lock and the WS4 design-tokens test.
 *
 * Scope: CSS custom properties declared in globals.css ONLY. We do NOT resolve
 * Tailwind theme tokens — e.g. `--accent: var(--brand-500, #185fa5);` is matched
 * as the literal declaration line that lives in globals.css; `brand-500` itself
 * lives in tailwind.config.ts and is intentionally out of scope here.
 *
 * Matching is whitespace-normalised (runs of whitespace, incl. newlines, collapse
 * to a single space) so the lock is insensitive to CSS line-wrapping of long
 * box-shadow values — it locks the token name and its full value, not the
 * formatter's choice of where to wrap. Direction is one-way by design: the skill
 * may document a subset; globals.css may carry tokens the skill omits.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SKILL_MD = path.resolve(
  __dirname,
  "../../../../.claude/skills/adserve-design/SKILL.md"
);
const GLOBALS_CSS = path.resolve(__dirname, "../../src/app/globals.css");

/** Collapse all whitespace runs to a single space for formatter-insensitive matching. */
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Extract the verbatim token block between the TOKENS:BEGIN / TOKENS:END markers. */
function extractCatalogueBlock(skill: string): string {
  const begin = skill.indexOf("TOKENS:BEGIN");
  const end = skill.indexOf("TOKENS:END");
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error(
      "adserve-design SKILL.md is missing the TOKENS:BEGIN / TOKENS:END catalogue markers"
    );
  }
  return skill.slice(begin, end);
}

/**
 * Pull every CSS custom-property declaration (`--name: value;`) out of the
 * catalogue block. Handles long values that wrap across lines by first joining
 * the block into one whitespace-normalised string, then splitting on `;`.
 */
function declarationsFrom(block: string): string[] {
  const flat = normalize(block);
  // Match `--token: <value>;` up to the next semicolon.
  const matches = flat.match(/--[a-z0-9-]+:\s*[^;]+;/gi) ?? [];
  // De-duplicate while preserving order (light + dark may repeat a name with a
  // different value; both are distinct declaration strings and both are checked).
  return [...new Set(matches.map((d) => normalize(d)))];
}

describe("adserve-design token catalogue is value-locked to globals.css", () => {
  const skill = readFileSync(SKILL_MD, "utf8");
  const globals = normalize(readFileSync(GLOBALS_CSS, "utf8"));
  const block = extractCatalogueBlock(skill);
  const declarations = declarationsFrom(block);

  test("catalogue block is present and non-trivial", () => {
    // Guard against an empty/garbled block silently passing the per-token loop.
    expect(declarations.length).toBeGreaterThanOrEqual(20);
  });

  for (const decl of declarations) {
    test(`globals.css declares verbatim: ${decl}`, () => {
      expect(globals).toContain(decl);
    });
  }
});
