import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  userInitials,
  readShellConfig,
  getTenantModules,
  MODULE_HOME,
} from "@/lib/shell";
import {
  setupCrmTenant,
  teardownCrmTenant,
  type CrmTestSetup,
} from "../helpers/crm";

describe("userInitials", () => {
  test("two-word name → first+last initials", () => {
    expect(userInitials("Alice Anderson")).toBe("AA");
    expect(userInitials("  jane  mary  doe ")).toBe("JD");
  });
  test("single word → one initial", () => {
    expect(userInitials("Bob")).toBe("B");
  });
  test("falls back to email, then '?'", () => {
    expect(userInitials(null, "zoe@x.com")).toBe("ZO");
    expect(userInitials("", "")).toBe("?");
    expect(userInitials(undefined)).toBe("?");
  });
});

describe("readShellConfig", () => {
  test("defaults: no logo, always-on title bar", () => {
    for (const s of [undefined, null, {}, { branding: {}, shell: {} }]) {
      const c = readShellConfig(s);
      expect(c.logoUrl).toBeNull();
      expect(c.titleBarMode).toBe("always");
    }
  });
  test("reads logo + auto-hide mode from settings", () => {
    const c = readShellConfig({
      branding: { logoUrl: "data:image/png;base64,AAA" },
      shell: { titleBarMode: "auto-hide" },
    });
    expect(c.logoUrl).toBe("data:image/png;base64,AAA");
    expect(c.titleBarMode).toBe("auto-hide");
  });
  test("invalid titleBarMode → always", () => {
    expect(readShellConfig({ shell: { titleBarMode: "bogus" } }).titleBarMode).toBe(
      "always"
    );
  });
});

describe("getTenantModules (adserve_app harness)", () => {
  let A: CrmTestSetup;
  beforeAll(async () => {
    A = await setupCrmTenant();
  });
  afterAll(async () => {
    if (A?.tenantId) await teardownCrmTenant(A.tenantId);
  });

  test("CRM is available (licensed + active + routable); coming-soon modules are not", async () => {
    const mods = await getTenantModules(A.tenantId);
    const crm = mods.find((m) => m.slug === "crm");
    expect(crm).toBeTruthy();
    expect(crm!.available).toBe(true);
    expect(crm!.href).toBe(MODULE_HOME.crm);

    // The seeded coming_soon catalogue modules are listed but not available.
    const campaigns = mods.find((m) => m.slug === "campaigns");
    if (campaigns) expect(campaigns.available).toBe(false);
  });
});
