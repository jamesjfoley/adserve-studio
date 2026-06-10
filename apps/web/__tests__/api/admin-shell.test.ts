import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import { tenants } from "@adserve/database";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { PATCH as patchShell } from "@/app/api/admin/shell/route";

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

async function readSettings(tenantId: string) {
  const [row] = await testDb
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return (row?.settings ?? {}) as Record<string, unknown>;
}

describe("Branding & shell settings write (/api/admin/shell)", () => {
  test("a crm.admin owner can save logoUrl + titleBarMode; they persist to settings.branding/shell", async () => {
    actAsOwner(A);
    const logoUrl = "data:image/png;base64,AAAA";
    const res = await patchShell(
      patchReq({ logoUrl, titleBarMode: "auto-hide" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ logoUrl, titleBarMode: "auto-hide" });

    const settings = await readSettings(A.tenantId);
    expect((settings.branding as { logoUrl?: string }).logoUrl).toBe(logoUrl);
    expect((settings.shell as { titleBarMode?: string }).titleBarMode).toBe(
      "auto-hide"
    );
  });

  test("preserves other settings keys (e.g. clerkOrgId) on write", async () => {
    actAsOwner(A);
    const before = await readSettings(A.tenantId);
    const clerkOrgId = (before as { clerkOrgId?: string }).clerkOrgId;

    const res = await patchShell(patchReq({ titleBarMode: "always" }));
    expect(res.status).toBe(200);

    const after = await readSettings(A.tenantId);
    expect((after as { clerkOrgId?: string }).clerkOrgId).toBe(clerkOrgId);
    // Branding from the prior test is preserved when only shell is written.
    expect((after.branding as { logoUrl?: string }).logoUrl).toBe(
      "data:image/png;base64,AAAA"
    );
    expect((after.shell as { titleBarMode?: string }).titleBarMode).toBe(
      "always"
    );
  });

  test("can clear the logo with null", async () => {
    actAsOwner(A);
    const res = await patchShell(patchReq({ logoUrl: null }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logoUrl).toBeNull();
    const settings = await readSettings(A.tenantId);
    expect((settings.branding as { logoUrl?: string | null }).logoUrl).toBeNull();
  });

  test("rejects an invalid titleBarMode (400)", async () => {
    actAsOwner(A);
    const res = await patchShell(patchReq({ titleBarMode: "sometimes" }));
    expect(res.status).toBe(400);
  });

  test("rejects a non-string / bad-scheme logoUrl (400)", async () => {
    actAsOwner(A);
    const bad = await patchShell(patchReq({ logoUrl: "ftp://example.com/x.png" }));
    expect(bad.status).toBe(400);
    const nonString = await patchShell(patchReq({ logoUrl: 123 }));
    expect(nonString.status).toBe(400);
  });

  test("a member (no crm.admin/tenant.admin) gets 403", async () => {
    actAsMember(A);
    const res = await patchShell(patchReq({ titleBarMode: "always" }));
    expect(res.status).toBe(403);
  });

  test("tenant isolation — writing tenant A's branding does not change tenant B's", async () => {
    // Establish a known config on B.
    actAsOwner(B);
    const seedB = await patchShell(
      patchReq({
        logoUrl: "https://cdn.example.com/b-logo.png",
        titleBarMode: "always",
      })
    );
    expect(seedB.status).toBe(200);
    const bBefore = await readSettings(B.tenantId);

    // Mutate A.
    actAsOwner(A);
    const resA = await patchShell(
      patchReq({
        logoUrl: "https://cdn.example.com/a-logo.png",
        titleBarMode: "auto-hide",
      })
    );
    expect(resA.status).toBe(200);

    // B is unchanged.
    const bAfter = await readSettings(B.tenantId);
    expect(bAfter.branding).toEqual(bBefore.branding);
    expect(bAfter.shell).toEqual(bBefore.shell);
    expect((bAfter.branding as { logoUrl?: string }).logoUrl).toBe(
      "https://cdn.example.com/b-logo.png"
    );
  });
});
