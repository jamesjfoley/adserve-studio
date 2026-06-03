import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import { tenants, withTenant } from "@adserve/database";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { getTenantContextOrNull } from "@/lib/permissions";
import { readTenantPalette } from "@/lib/theme/palettes";

// The (tenant-admin) layout resolves its palette exactly this way:
// requireTenantAdmin → getTenantContextOrNull (per-request, tenant-keyed, not
// memoised) → readTenantPalette(ctx.tenant.settings) → data-palette on the root.
// These tests exercise that read path directly.

let A: CrmTestSetup;
let B: CrmTestSetup;

function actAs(t: CrmTestSetup) {
  authMock.mockResolvedValue({ userId: t.owner.authProviderId, orgId: t.clerkOrgId });
}
async function seedPalette(tenantId: string, palette: string) {
  const [row] = await testDb
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const cur = (row.settings ?? {}) as Record<string, unknown>;
  const theme = (cur.theme ?? {}) as Record<string, unknown>;
  await testDb
    .update(tenants)
    .set({ settings: { ...cur, theme: { ...theme, palette } } })
    .where(eq(tenants.id, tenantId));
}
async function layoutPalette() {
  // Mirrors the admin layout's resolution.
  const ctx = await getTenantContextOrNull();
  return readTenantPalette(ctx?.tenant.settings);
}

beforeAll(async () => {
  A = await setupCrmTenant();
  B = await setupCrmTenant();
});
afterAll(async () => {
  if (A?.tenantId) await teardownCrmTenant(A.tenantId);
  if (B?.tenantId) await teardownCrmTenant(B.tenantId);
});

describe("admin-palette — (tenant-admin) layout palette resolution", () => {
  test("the /admin area resolves the acting tenant's palette", async () => {
    await seedPalette(A.tenantId, "emerald");
    actAs(A);
    expect(await layoutPalette()).toBe("emerald");
  });

  test("per-request no-leak: sequential A → B → A each get their own palette", async () => {
    await seedPalette(A.tenantId, "emerald");
    await seedPalette(B.tenantId, "violet");

    actAs(A);
    expect(await layoutPalette()).toBe("emerald");
    actAs(B);
    expect(await layoutPalette()).toBe("violet");
    actAs(A);
    expect(await layoutPalette()).toBe("emerald"); // nothing pinned at module scope
  });

  test("settings read respects RLS: tenant A cannot read tenant B's settings", async () => {
    const rows = await withTenant(A.tenantId, (tx) =>
      tx
        .select({ id: tenants.id, settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, B.tenantId))
    );
    expect(rows).toHaveLength(0);
    // Control: A reads its own row.
    const own = await withTenant(A.tenantId, (tx) =>
      tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, A.tenantId))
    );
    expect(own).toHaveLength(1);
  });
});
