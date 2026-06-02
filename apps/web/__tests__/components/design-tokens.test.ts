import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * WS4 acceptance criteria #18 and #19 — design tokens in globals.css.
 *
 * #18: the new WS4 tokens are defined in :root, and the five pre-existing
 * palette vars plus the prefers-color-scheme: dark block remain present and
 * unchanged in value.
 * #19: each elevation token has a defined non-empty value in BOTH the light
 * :root and the dark-mode block (or resolves through an already-overridden base
 * var) — no token resolves to an empty string in either scheme.
 *
 * A static source-scan of globals.css; no DOM/CSSOM needed (jsdom does not
 * resolve CSS custom properties from a linked stylesheet anyway).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GLOBALS = path.resolve(__dirname, "../../src/app/globals.css");
const CSS = readFileSync(GLOBALS, "utf8");

/** Extract the first `:root { … }` block (the light-mode declarations). */
function lightRoot(css: string): string {
  const m = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!m) throw new Error("no :root block found in globals.css");
  return m[1];
}

/** Extract the dark-mode :root block inside the prefers-color-scheme media. */
function darkRoot(css: string): string {
  const m = css.match(
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?:root\s*\{([\s\S]*?)\}/
  );
  if (!m) throw new Error("no dark-mode :root block found in globals.css");
  return m[1];
}

/** Read the declared value of a custom property within a block. */
function tokenValue(block: string, name: string): string | null {
  const re = new RegExp(
    `${name.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+);`
  );
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

const LIGHT = lightRoot(CSS);
const DARK = darkRoot(CSS);

const EXISTING_PALETTE: Record<string, string> = {
  "--background": "#ffffff",
  "--foreground": "#171717",
  "--muted": "#f5f5f5",
  "--muted-foreground": "#737373",
  "--border": "#e5e5e5",
};

const NEW_ROOT_TOKENS = [
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
  "--space-8",
  "--radius-sm",
  "--radius-md",
  "--radius-panel",
  "--radius-full",
  "--border-width",
  "--border-color",
  "--elevation-0",
  "--elevation-1",
  "--elevation-2",
  "--elevation-3",
  "--panel-padding",
  "--panel-padding-sm",
  "--panel-bg",
  "--panel-border",
  "--page-bg",
  "--accent",
  "--accent-foreground",
];

const ELEVATION_TOKENS = ["--elevation-0", "--elevation-1", "--elevation-2", "--elevation-3"];

describe("WS4 #18 — new tokens defined in :root, existing palette preserved", () => {
  for (const token of NEW_ROOT_TOKENS) {
    test(`${token} is defined with a non-empty value in :root`, () => {
      const v = tokenValue(LIGHT, token);
      expect(v, `${token} missing from :root`).not.toBeNull();
      expect(v).not.toBe("");
    });
  }

  for (const [name, value] of Object.entries(EXISTING_PALETTE)) {
    test(`existing palette var ${name} is preserved with value ${value}`, () => {
      expect(tokenValue(LIGHT, name)?.toLowerCase()).toBe(value.toLowerCase());
    });
  }

  test("the prefers-color-scheme: dark block is still present", () => {
    expect(CSS).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
    // The five dark overrides remain.
    for (const name of Object.keys(EXISTING_PALETTE)) {
      expect(tokenValue(DARK, name), `${name} missing from dark block`).not.toBeNull();
    }
  });
});

describe("WS4 #19 — elevation tokens resolve in both light and dark schemes", () => {
  for (const token of ELEVATION_TOKENS) {
    test(`${token} has a non-empty value in light :root`, () => {
      const v = tokenValue(LIGHT, token);
      expect(v, `${token} missing from light :root`).not.toBeNull();
      expect(v).not.toBe("");
    });
  }

  // The plan declares dark overrides for elevation 1/2/3; elevation-0 ("none")
  // reads identically on dark so it needs no override — assert the three that do.
  for (const token of ["--elevation-1", "--elevation-2", "--elevation-3"]) {
    test(`${token} has a non-empty dark-mode override`, () => {
      const v = tokenValue(DARK, token);
      expect(v, `${token} missing from dark block`).not.toBeNull();
      expect(v).not.toBe("");
    });
  }

  test("no elevation token is left empty in either scheme", () => {
    for (const token of ELEVATION_TOKENS) {
      expect(tokenValue(LIGHT, token)).toBeTruthy();
    }
    for (const token of ["--elevation-1", "--elevation-2", "--elevation-3"]) {
      expect(tokenValue(DARK, token)).toBeTruthy();
    }
  });
});
