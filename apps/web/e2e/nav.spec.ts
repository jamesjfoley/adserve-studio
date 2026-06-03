import { test, expect } from "@playwright/test";

// Auth is provided by the `setup` project via storageState (see
// playwright.config.ts + auth.setup.ts), so every test starts already signed in
// against the real (platform) shell — no public route, middleware untouched.

// The CRM shell route that renders <PrimaryNav>.
const CRM_ROUTE = "/dashboard";

function setStoredPinned(value: "true" | "false") {
  return `try { localStorage.setItem('adserve:nav:pinned', '${value}'); } catch (e) {}`;
}

test.describe("WS5 — collapsible/pinnable CRM nav", () => {
  test("stored-unpinned load paints as a rail with no expand->rail animation (no FOUC)", async ({
    page,
  }) => {
    // Seed the pref BEFORE load so the inline <head> script reads it pre-paint.
    await page.addInitScript(setStoredPinned("false"));
    await page.goto(CRM_ROUTE);

    // The head script set the attribute before paint.
    await expect(page.locator("html")).toHaveAttribute(
      "data-nav-pinned",
      "false"
    );

    const dock = page.locator(".primary-nav-dock");
    await expect(dock).toBeVisible();

    // First paint is already the rail width and never widens to the pinned
    // width (no full->rail collapse animation, hence no FOUC). Sample twice to
    // confirm it is stable, not mid-animation toward the pinned width.
    const railWidth = await dock.evaluate(
      (el) => el.getBoundingClientRect().width
    );
    expect(railWidth).toBeLessThan(100); // ~56px rail, not ~256px pinned
    const railWidthAgain = await dock.evaluate(
      (el) => el.getBoundingClientRect().width
    );
    expect(railWidthAgain).toBeLessThan(100);
  });

  test("hovering the rail expands the overlay and content does NOT reflow", async ({
    page,
  }) => {
    await page.addInitScript(setStoredPinned("false"));
    await page.goto(CRM_ROUTE);

    const dock = page.locator(".primary-nav-dock");
    const panel = page.locator(".primary-nav-panel");
    const main = page.locator("main");
    await expect(panel).toBeVisible();

    const dockWidthBefore = await dock.evaluate(
      (el) => el.getBoundingClientRect().width
    );
    const mainLeftBefore = await main.evaluate(
      (el) => el.getBoundingClientRect().left
    );

    await panel.hover();
    await expect(panel).toHaveClass(/is-expanded/);
    await expect
      .poll(async () =>
        panel.evaluate((el) => el.getBoundingClientRect().width)
      )
      .toBeGreaterThan(200);

    // No reflow: the in-flow dock width and main's left edge are unchanged.
    const dockWidthAfter = await dock.evaluate(
      (el) => el.getBoundingClientRect().width
    );
    const mainLeftAfter = await main.evaluate(
      (el) => el.getBoundingClientRect().left
    );
    expect(Math.abs(dockWidthAfter - dockWidthBefore)).toBeLessThan(1);
    expect(Math.abs(mainLeftAfter - mainLeftBefore)).toBeLessThan(1);
  });

  test("pointer-leave and Escape collapse the overlay", async ({ page }) => {
    await page.addInitScript(setStoredPinned("false"));
    await page.goto(CRM_ROUTE);

    const panel = page.locator(".primary-nav-panel");
    await expect(panel).toBeVisible();

    // Pointer-leave collapses (mouse path).
    await panel.hover();
    await expect(panel).toHaveClass(/is-expanded/);
    await page.mouse.move(600, 400);
    await expect(panel).not.toHaveClass(/is-expanded/);

    // Escape collapses (keyboard path): focusing a rail item expands the
    // overlay, then Escape — focus is inside the panel — collapses it.
    await panel.locator("a").first().focus();
    await expect(panel).toHaveClass(/is-expanded/);
    await page.keyboard.press("Escape");
    await expect(panel).not.toHaveClass(/is-expanded/);
  });

  test("prefers-reduced-motion disables the width transition", async ({
    page,
  }) => {
    // Emulate reduced motion directly on the page (more reliable than a
    // describe-level test.use under a storageState project).
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(setStoredPinned("false"));
    await page.goto(CRM_ROUTE);

    const dock = page.locator(".primary-nav-dock");
    await expect(dock).toBeVisible();

    const result = await dock.evaluate((el) => ({
      rmMatches: matchMedia("(prefers-reduced-motion: reduce)").matches,
      duration: getComputedStyle(el).transitionDuration,
    }));
    // Precondition: reduced motion is genuinely active for the page.
    expect(result.rmMatches).toBe(true);
    // The @media (prefers-reduced-motion: reduce) rule sets transition: none.
    expect(result.duration === "0s" || result.duration === "").toBe(true);
  });
});
