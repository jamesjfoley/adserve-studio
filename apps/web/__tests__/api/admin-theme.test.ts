import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import { tenants, withTenant } from "@adserve/database";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { PATCH as setTheme } from "@/app/api/admin/theme/route";
import { getTenantContextOrNull } from "@/lib/permissions";
import { readTenantPalette } from "@/lib/theme/palettes";

let A: CrmTestSetup;
let B: CrmTestSetup;

function actAs(authProviderId: string | null, orgId: string | null) {
  authMock.mockResolvedValue({ userId: authProviderId, orgId });
}
function req(body?: unknown) {
  return new NextRequest("http://localhost/api/admin/theme", {
    method: "PATCH",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
// Privileged read of the persisted palette (fixtures seed via the superuser db).
async function persistedPalette(tenantId: string) {
  const [row] = await testDb
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return readTenantPalette(row.settings);
}

beforeAll(async () => {
  A = await setupCrmTenant();
  B = await setupCrmTenant();
});
afterAll(async () => {
  if (A?.tenantId) await teardownCrmTenant(A.tenantId);
  if (B?.tenantId) await teardownCrmTenant(B.tenantId);
});

describe("WS6 — per-org palette (AC 19 + Condition 6 + write authz)", () => {
  test("AC 19: an admin sets A's palette; A renders it and NO other org is affected", async () => {
    // Both default before any selection.
    expect(await persistedPalette(A.tenantId)).toBe("grey-blue");
    expect(await persistedPalette(B.tenantId)).toBe("grey-blue");

    actAs(A.owner.authProviderId, A.clerkOrgId); // owner holds crm.admin
    const res = await setTheme(req({ palette: "emerald" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ palette: "emerald" });

    expect(await persistedPalette(A.tenantId)).toBe("emerald"); // A changed
    expect(await persistedPalette(B.tenantId)).toBe("grey-blue"); // B untouched
  });

  test("per-request no-leak: sequential context reads for A then B each return their own palette", async () => {
    actAs(A.owner.authProviderId, A.clerkOrgId);
    expect((await setTheme(req({ palette: "emerald" }))).status).toBe(200);
    actAs(B.owner.authProviderId, B.clerkOrgId);
    expect((await setTheme(req({ palette: "violet" }))).status).toBe(200);

    // Drive the REAL per-request read path (the layout's source) twice in a row.
    actAs(A.owner.authProviderId, A.clerkOrgId);
    expect(readTenantPalette((await getTenantContextOrNull())?.tenant.settings)).toBe(
      "emerald"
    );
    actAs(B.owner.authProviderId, B.clerkOrgId);
    expect(readTenantPalette((await getTenantContextOrNull())?.tenant.settings)).toBe(
      "violet"
    );
    // Back to A — proves nothing pinned B's value at module scope.
    actAs(A.owner.authProviderId, A.clerkOrgId);
    expect(readTenantPalette((await getTenantContextOrNull())?.tenant.settings)).toBe(
      "emerald"
    );
  });

  test("settings read respects RLS: tenant A cannot read tenant B's settings", async () => {
    const rows = await withTenant(A.tenantId, (tx) =>
      tx
        .select({ id: tenants.id, settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, B.tenantId))
    );
    expect(rows).toHaveLength(0); // RLS hides B's row from A's tenant context
    // Control: A can read its own row.
    const own = await withTenant(A.tenantId, (tx) =>
      tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, A.tenantId))
    );
    expect(own).toHaveLength(1);
  });

  test("write authz: a member without tenant.admin/crm.admin is rejected (403)", async () => {
    actAs(A.member.authProviderId, A.clerkOrgId);
    const res = await setTheme(req({ palette: "slate" }));
    expect(res.status).toBe(403);
    expect(await persistedPalette(A.tenantId)).not.toBe("slate"); // unchanged
  });

  test("unauthenticated → 401; unknown palette id → 400 (catalog-validated)", async () => {
    actAs(null, null);
    expect((await setTheme(req({ palette: "emerald" }))).status).toBe(401);

    actAs(A.owner.authProviderId, A.clerkOrgId);
    expect((await setTheme(req({ palette: "neon-pink" }))).status).toBe(400);
  });
});
