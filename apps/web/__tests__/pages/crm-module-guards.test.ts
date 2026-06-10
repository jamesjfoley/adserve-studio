import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import { records } from "@adserve/database";
import {
  setupCrmTenant,
  teardownCrmTenant,
  setCrmModuleConfig,
  type CrmTestSetup,
} from "../helpers/crm";

// notFound()/redirect() throw sentinels we can assert on (mirrors Next's
// control-flow-by-throw). A page that 404s throws NEXT_NOT_FOUND; one that
// redirects throws NEXT_REDIRECT.
const navMock = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("next/navigation", () => navMock);

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { getCrmModuleConfig } from "@/lib/crm/module-config";
import { POST as createWithAccount } from "@/app/api/crm/campaigns/with-account/route";
import CrmListPage from "@/app/(platform)/crm/[entityType]/page";

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

describe("getCrmModuleConfig — tenant isolation (Task 7)", () => {
  test("each tenant resolves ITS OWN config, never the other's", async () => {
    await setCrmModuleConfig(A.tenantId, {
      leads: false,
      campaigns: true,
      opportunities: true,
      convertTarget: "opportunity",
    });
    await setCrmModuleConfig(B.tenantId, {
      leads: true,
      campaigns: false,
      opportunities: false,
      convertTarget: "campaign",
    });

    const a = await getCrmModuleConfig(A.tenantId);
    const b = await getCrmModuleConfig(B.tenantId);

    expect(a.leads).toBe(false);
    expect(a.opportunities).toBe(true);
    expect(a.effectiveConvertTarget).toBe("opportunity");

    expect(b.leads).toBe(true);
    expect(b.campaigns).toBe(false);
    expect(b.showPipeline).toBe(false);
    expect(b.effectiveConvertTarget).toBeNull();
  });
});

describe("Module toggle-off retains record data (Task 7)", () => {
  test("disabling then re-enabling Campaigns never deletes/mutates the records", async () => {
    await setCrmModuleConfig(A.tenantId, { campaigns: true });
    actAsOwner(A);
    const res = await createWithAccount(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: { name: "Retained Campaign", stage: "brief" },
          newAccountName: "Retention Co",
        }),
      })
    );
    expect(res.status).toBe(201);
    const campaignId = (await res.json()).record.id as string;

    const present = async () => {
      const [row] = await testDb
        .select({ id: records.id, isArchived: records.isArchived })
        .from(records)
        .where(and(eq(records.id, campaignId), eq(records.tenantId, A.tenantId)));
      return row;
    };

    await setCrmModuleConfig(A.tenantId, { campaigns: false });
    const afterDisable = await present();
    expect(afterDisable).toBeTruthy();
    expect(afterDisable.isArchived).toBe(false); // hidden, not archived/deleted

    await setCrmModuleConfig(A.tenantId, { campaigns: true });
    const afterReenable = await present();
    expect(afterReenable).toBeTruthy();
    expect(afterReenable.isArchived).toBe(false);
  });
});

describe("Route guard — module check precedes permission (Task 7)", () => {
  test("a disabled module 404s even for a fully-permitted user", async () => {
    // Owner has campaign.read (full perms). Disable Campaigns for the tenant.
    await setCrmModuleConfig(A.tenantId, { campaigns: false });
    actAsOwner(A);
    navMock.notFound.mockClear();
    navMock.redirect.mockClear();

    await expect(
      CrmListPage({
        params: Promise.resolve({ entityType: "campaigns" }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    // It 404'd (module gate) — it did NOT fall through to a permission redirect.
    expect(navMock.notFound).toHaveBeenCalled();
    expect(navMock.redirect).not.toHaveBeenCalled();
  });

  test("an enabled module does NOT 404 on the module gate (control)", async () => {
    await setCrmModuleConfig(A.tenantId, { campaigns: true });
    actAsOwner(A);
    navMock.notFound.mockClear();

    // It renders (or throws later for unrelated reasons) — but the module gate
    // must NOT be the thing that 404s when the module is enabled.
    try {
      await CrmListPage({
        params: Promise.resolve({ entityType: "campaigns" }),
        searchParams: Promise.resolve({}),
      });
    } catch {
      // ignore — we only assert the module gate didn't fire.
    }
    expect(navMock.notFound).not.toHaveBeenCalled();
  });
});
