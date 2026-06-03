import { test, expect, type Page } from "@playwright/test";

// Auth comes from the `setup` project's storageState (see playwright.config.ts).
// This spec proves the ACCENT RE-SKIN: switching the palette id produces a
// visible colour shift on a representative accented element. The WS6 write/read
// plumbing (per-org persistence, per-request resolution, RLS, write authz) is
// covered by the vitest suite (__tests__/api/admin-theme.test.ts).

const CATALOG: Record<string, string> = {
  "grey-blue": "#185fa5",
  slate: "#334155",
  emerald: "#047857",
  violet: "#6d28d9",
};

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function contrast(hex: string, other: string): number {
  const lum = (h: string) => {
    const n = parseInt(h.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const a = lum(hex);
  const b = lum(other);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** The active route link is re-skinned to text-[var(--accent)]. */
function activeNavLink(page: Page) {
  return page
    .locator('nav[aria-label="Primary"] [aria-current="page"]')
    .first();
}

test.describe("WS6 palette is visible (accent re-skin)", () => {
  test("switching the palette shifts the active nav link's colour to the catalog accent", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const active = activeNavLink(page);
    await expect(active).toBeVisible();

    for (const id of ["emerald", "violet", "grey-blue"] as const) {
      // Drive the palette the same way WS6 does — the data-palette attribute on
      // the (platform) layout root — and assert the accent cascades to the link.
      await page.evaluate((p) => {
        const root = document.querySelector("[data-palette]") as HTMLElement;
        root.dataset.palette = p;
      }, id);
      await expect
        .poll(async () => active.evaluate((el) => getComputedStyle(el).color))
        .toBe(hexToRgb(CATALOG[id]));
    }
  });

  test("the real org-palette write applies end-to-end (requires an admin e2e user)", async ({
    page,
  }) => {
    // Reads the signed-in user's permissions; only an admin can exercise the
    // WS6 write path. Skips (does not fail) for a non-admin e2e user.
    const me = await (await page.request.get("/api/me/permissions")).json();
    const perms: string[] = me.permissions ?? [];
    const canWrite =
      perms.includes("tenant.admin") || perms.includes("crm.admin");
    test.skip(
      !canWrite,
      "e2e user lacks tenant.admin/crm.admin — grant it to exercise the real WS6 write here (the re-skin itself is verified above)."
    );

    try {
      for (const id of ["emerald", "violet"] as const) {
        const res = await page.request.patch("/api/admin/theme", {
          data: { palette: id },
        });
        expect(res.status()).toBe(200);
        await page.goto("/dashboard");
        await expect
          .poll(async () =>
            activeNavLink(page).evaluate((el) => getComputedStyle(el).color)
          )
          .toBe(hexToRgb(CATALOG[id]));
      }
    } finally {
      await page.request.patch("/api/admin/theme", {
        data: { palette: "grey-blue" },
      });
    }
  });

  test("accent-as-text meets WCAG-AA (>=4.5:1) on white for all four palettes", () => {
    for (const hex of Object.values(CATALOG)) {
      expect(contrast(hex, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
  });
});
