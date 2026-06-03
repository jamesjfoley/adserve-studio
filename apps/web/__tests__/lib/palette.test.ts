import { describe, expect, test } from "vitest";
import {
  DEFAULT_PALETTE,
  PALETTES,
  PALETTE_IDS,
  isPaletteId,
  readTenantPalette,
  resolvePaletteId,
} from "@/lib/theme/palettes";

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
});
