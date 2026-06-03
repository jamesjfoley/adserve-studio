import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_PALETTE,
  PALETTES,
  PALETTE_IDS,
  isPaletteId,
  readTenantPalette,
  resolvePaletteId,
} from "@/lib/theme/palettes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GLOBALS_CSS = path.resolve(__dirname, "../../src/app/globals.css");

describe("WS6 palette catalog", () => {
  test("default is grey-blue", () => {
    expect(DEFAULT_PALETTE).toBe("grey-blue");
  });

  test("catalog holds exactly the four v1 palettes", () => {
    expect([...PALETTE_IDS]).toEqual(["grey-blue", "slate", "emerald", "violet"]);
  });

  test("isPaletteId validates membership", () => {
    expect(isPaletteId("emerald")).toBe(true);
    expect(isPaletteId("neon-pink")).toBe(false);
    expect(isPaletteId(null)).toBe(false);
    expect(isPaletteId(123)).toBe(false);
  });

  test("resolvePaletteId falls back to default for unknown/absent", () => {
    expect(resolvePaletteId("violet")).toBe("violet");
    expect(resolvePaletteId("bogus")).toBe(DEFAULT_PALETTE);
    expect(resolvePaletteId(undefined)).toBe(DEFAULT_PALETTE);
    expect(resolvePaletteId(null)).toBe(DEFAULT_PALETTE);
  });

  test("readTenantPalette reads settings.theme.palette with fallback", () => {
    expect(readTenantPalette({ theme: { palette: "slate" } })).toBe("slate");
    // clerkOrgId present but no theme → default.
    expect(readTenantPalette({ clerkOrgId: "org_x" })).toBe(DEFAULT_PALETTE);
    expect(readTenantPalette(null)).toBe(DEFAULT_PALETTE);
    expect(readTenantPalette({ theme: { palette: "bogus" } })).toBe(
      DEFAULT_PALETTE
    );
  });

  test("every catalog entry uses the WCAG-AA white foreground seam value", () => {
    for (const id of PALETTE_IDS) {
      expect(PALETTES[id].accentForeground).toBe("#ffffff");
      expect(PALETTES[id].accent).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  // WS6 follow-up: the :root baseline accent must equal grey-blue's, so the
  // default palette (no data-palette attribute) renders identically to an
  // explicit grey-blue selection.
  test("globals.css :root baseline accent equals grey-blue", () => {
    const css = readFileSync(GLOBALS_CSS, "utf8");
    const greyBlue = PALETTES["grey-blue"].accent; // #185fa5

    // :root baseline references brand-500 / the grey-blue hex.
    const root = css.match(/:root\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(root).toMatch(
      new RegExp(`--accent:[^;]*${greyBlue}`, "i")
    );

    // The explicit grey-blue catalog rule sets the same hex.
    const rule =
      css.match(/\[data-palette="grey-blue"\]\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(rule).toMatch(new RegExp(`--accent:\\s*${greyBlue}`, "i"));
  });
});
