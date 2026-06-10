import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import { tenants } from "@adserve/database";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { PATCH as patchModules } from "@/app/api/admin/crm/modules/route";

let A: CrmTestSetup;
let B: CrmTestSetup;

beforeAll(async () => {
  A = await setupCrmTenant();
  B = await setupCrmTenant();
});
afterAll(async () => {
  if (A?.tenantId) await teardownCrmTenant(A.tenantId);
  if (B?.tenantId) await teardownCrmTenant(B.tenantId);
});

function actAsOwner(t: CrmTestSetup) {
  authMock.mockResolvedValue({ userId: t.owner.authProviderId, orgId: t.clerkOrgId });
}
function actAsMember(t: CrmTestSetup) {
  authMock.mockResolvedValue({ userId: t.member.authProviderId, orgId: t.clerkOrgId });
}
function patchReq(body: unknown) {
  return new NextRequest("http://localhost", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readCrm(tenantId: string) {
  const [row] = await testDb
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return (
    (row?.settings as { modules?: { crm?: Record<string, unknown> } } | null)
      ?.modules?.crm ?? null
  );
}

describe("CRM modules config write (Task 6)", () => {
  test("a crm.admin owner can set toggles and they persist to settings.modules.crm", async () => {
    actAsOwner(A);
    const res = await patchModules(
      patchReq({
        leads: false,
        campaigns: true,
        opportunities: true,
        convertTarget: "opportunity",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      leads: false,
      campaigns: true,
      opportunities: true,
      convertTarget: "opportunity",
    });

    const persisted = await readCrm(A.tenantId);
    expect(persisted).toMatchObject({
      leads: false,
      campaigns: true,
      opportunities: true,
      convertTarget: "opportunity",
    });
  });

  test("preserves other settings keys (e.g. clerkOrgId) on write", async () => {
    actAsOwner(A);
    const before = await testDb
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, A.tenantId));
    const clerkOrgId = (before[0].settings as { clerkOrgId?: string }).clerkOrgId;

    const res = await patchModules(patchReq({ leads: true }));
    expect(res.status).toBe(200);

    const after = await testDb
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, A.tenantId));
    expect((after[0].settings as { clerkOrgId?: string }).clerkOrgId).toBe(
      clerkOrgId
    );
  });

  test("rejects an invalid convertTarget (400)", async () => {
    actAsOwner(A);
    const res = await patchModules(patchReq({ convertTarget: "lead" }));
    expect(res.status).toBe(400);
  });

  test("rejects a non-boolean toggle (400)", async () => {
    actAsOwner(A);
    const res = await patchModules(patchReq({ leads: "yes" }));
    expect(res.status).toBe(400);
  });

  test("a member (no crm.admin) gets 403", async () => {
    actAsMember(A);
    const res = await patchModules(patchReq({ leads: false }));
    expect(res.status).toBe(403);
  });

  test("tenant isolation — writing tenant A's config does not change tenant B's", async () => {
    // Establish a known config on B.
    actAsOwner(B);
    const seedB = await patchModules(
      patchReq({
        leads: true,
        campaigns: false,
        opportunities: false,
        convertTarget: "campaign",
      })
    );
    expect(seedB.status).toBe(200);
    const bBefore = await readCrm(B.tenantId);

    // Mutate A.
    actAsOwner(A);
    const resA = await patchModules(
      patchReq({
        leads: false,
        campaigns: true,
        opportunities: true,
        convertTarget: "opportunity",
      })
    );
    expect(resA.status).toBe(200);

    // B is unchanged.
    const bAfter = await readCrm(B.tenantId);
    expect(bAfter).toEqual(bBefore);
    expect(bAfter).toMatchObject({
      leads: true,
      campaigns: false,
      opportunities: false,
      convertTarget: "campaign",
    });
  });
});
