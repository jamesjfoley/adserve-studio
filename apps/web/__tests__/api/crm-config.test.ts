import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import { entityTypes, fieldDefinitions, records } from "@adserve/database";
import { getDefaultLayout } from "@adserve/module-framework";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { POST as createField, PATCH as reorderFields } from "@/app/api/admin/crm/fields/route";
import {
  PATCH as updateField,
  DELETE as deleteField,
} from "@/app/api/admin/crm/fields/[fieldId]/route";
import { PATCH as updateLayout } from "@/app/api/admin/crm/layouts/[layoutId]/route";
import { PATCH as updatePipeline } from "@/app/api/admin/crm/pipeline/route";

let crm: CrmTestSetup;
function actAs(authProviderId: string) {
  authMock.mockResolvedValue({ userId: authProviderId, orgId: crm.clerkOrgId });
}
function req(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function entityId(slug: string): Promise<string> {
  const [e] = await testDb
    .select({ id: entityTypes.id })
    .from(entityTypes)
    .where(and(eq(entityTypes.tenantId, crm.tenantId), eq(entityTypes.slug, slug)));
  return e.id;
}
async function fieldId(entitySlug: string, fieldSlug: string): Promise<string> {
  const [f] = await testDb
    .select({ id: fieldDefinitions.id })
    .from(fieldDefinitions)
    .where(
      and(
        eq(fieldDefinitions.tenantId, crm.tenantId),
        eq(fieldDefinitions.entityTypeId, await entityId(entitySlug)),
        eq(fieldDefinitions.slug, fieldSlug)
      )
    );
  return f.id;
}

beforeAll(async () => {
  crm = await setupCrmTenant();
});
afterAll(async () => {
  if (crm?.tenantId) await teardownCrmTenant(crm.tenantId);
});

describe("fields routes", () => {
  test("create custom field (201), duplicate slug (409), bad slug (400)", async () => {
    actAs(crm.owner.authProviderId);
    let res = await createField(
      req("http://localhost/api/admin/crm/fields", "POST", {
        entityType: "accounts",
        name: "Region",
        slug: "region",
        fieldType: "text",
      })
    );
    expect(res.status).toBe(201);

    res = await createField(
      req("http://localhost/api/admin/crm/fields", "POST", {
        entityType: "accounts",
        name: "Region 2",
        slug: "region",
        fieldType: "text",
      })
    );
    expect(res.status).toBe(409);

    res = await createField(
      req("http://localhost/api/admin/crm/fields", "POST", {
        entityType: "accounts",
        name: "Bad",
        slug: "Bad Slug",
        fieldType: "text",
      })
    );
    expect(res.status).toBe(400);
  });

  test("update a custom field's flags (200)", async () => {
    actAs(crm.owner.authProviderId);
    const id = await fieldId("account", "region");
    const res = await updateField(
      req(`http://localhost/api/admin/crm/fields/${id}`, "PATCH", {
        isFilterable: true,
        name: "Sales region",
      }),
      { params: Promise.resolve({ fieldId: id }) }
    );
    expect(res.status).toBe(200);
    const [row] = await testDb
      .select()
      .from(fieldDefinitions)
      .where(eq(fieldDefinitions.id, id));
    expect(row.isFilterable).toBe(true);
    expect(row.name).toBe("Sales region");
  });

  test("changing a SYSTEM field's type is blocked (422)", async () => {
    actAs(crm.owner.authProviderId);
    const id = await fieldId("account", "name"); // system field
    const res = await updateField(
      req(`http://localhost/api/admin/crm/fields/${id}`, "PATCH", {
        fieldType: "number",
      }),
      { params: Promise.resolve({ fieldId: id }) }
    );
    expect(res.status).toBe(422);
  });

  test("delete custom ok (200); delete system blocked (403)", async () => {
    actAs(crm.owner.authProviderId);
    const customId = await fieldId("account", "region");
    let res = await deleteField(
      req(`http://localhost/api/admin/crm/fields/${customId}`, "DELETE"),
      { params: Promise.resolve({ fieldId: customId }) }
    );
    expect(res.status).toBe(200);

    const sysId = await fieldId("account", "name");
    res = await deleteField(
      req(`http://localhost/api/admin/crm/fields/${sysId}`, "DELETE"),
      { params: Promise.resolve({ fieldId: sysId }) }
    );
    expect(res.status).toBe(403);
  });

  test("reorder updates displayOrder (200)", async () => {
    actAs(crm.owner.authProviderId);
    const accId = await entityId("account");
    const rows = await testDb
      .select({ id: fieldDefinitions.id })
      .from(fieldDefinitions)
      .where(eq(fieldDefinitions.entityTypeId, accId));
    const ids = rows.map((r) => r.id).reverse();
    const res = await reorderFields(
      req("http://localhost/api/admin/crm/fields", "PATCH", {
        entityType: "accounts",
        orderedFieldIds: ids,
      })
    );
    expect(res.status).toBe(200);
    const [first] = await testDb
      .select({ displayOrder: fieldDefinitions.displayOrder })
      .from(fieldDefinitions)
      .where(eq(fieldDefinitions.id, ids[0]));
    expect(first.displayOrder).toBe(0);
  });

  test("crm.admin gate: member is forbidden (403)", async () => {
    actAs(crm.member.authProviderId);
    const res = await createField(
      req("http://localhost/api/admin/crm/fields", "POST", {
        entityType: "accounts",
        name: "X",
        slug: "x_field",
        fieldType: "text",
      })
    );
    expect(res.status).toBe(403);
  });
});

describe("layouts route", () => {
  test("update config ok (200); unknown fieldId (422); gate (403)", async () => {
    actAs(crm.owner.authProviderId);
    const accId = await entityId("account");
    const layout = await getDefaultLayout(testDb, {
      tenantId: crm.tenantId,
      entityTypeId: accId,
      layoutType: "detail",
    });
    expect(layout).not.toBeNull();
    const nameFieldId = await fieldId("account", "name");

    let res = await updateLayout(
      req(`http://localhost/api/admin/crm/layouts/${layout!.id}`, "PATCH", {
        config: {
          sections: [{ title: "Main", columns: 1, fieldIds: [nameFieldId] }],
        },
      }),
      { params: Promise.resolve({ layoutId: layout!.id }) }
    );
    expect(res.status).toBe(200);

    res = await updateLayout(
      req(`http://localhost/api/admin/crm/layouts/${layout!.id}`, "PATCH", {
        config: {
          sections: [
            {
              title: "Bad",
              columns: 1,
              fieldIds: ["00000000-0000-0000-0000-000000000000"],
            },
          ],
        },
      }),
      { params: Promise.resolve({ layoutId: layout!.id }) }
    );
    expect(res.status).toBe(422);

    actAs(crm.member.authProviderId);
    res = await updateLayout(
      req(`http://localhost/api/admin/crm/layouts/${layout!.id}`, "PATCH", {
        config: { sections: [] },
      }),
      { params: Promise.resolve({ layoutId: layout!.id }) }
    );
    expect(res.status).toBe(403);
  });
});

describe("pipeline route", () => {
  const baseStages = [
    { slug: "qualification", name: "Qualification", defaultProbability: 10, isClosed: false, isWon: false },
    { slug: "proposal", name: "Proposal", defaultProbability: 50, isClosed: false, isWon: false },
    { slug: "closed_won", name: "Closed won", defaultProbability: 100, isClosed: true, isWon: true },
  ];

  test("rename (slug fixed) + reorder saves (200)", async () => {
    actAs(crm.owner.authProviderId);
    const renamed = [
      { ...baseStages[1] },
      { ...baseStages[0], name: "Qualifying" }, // rename, same slug; reordered
      { ...baseStages[2] },
    ];
    const res = await updatePipeline(
      req("http://localhost/api/admin/crm/pipeline", "PATCH", { stages: renamed })
    );
    expect(res.status).toBe(200);
    const [opp] = await testDb
      .select({ settings: entityTypes.settings })
      .from(entityTypes)
      .where(
        and(
          eq(entityTypes.tenantId, crm.tenantId),
          eq(entityTypes.slug, "opportunity")
        )
      );
    const stages = (opp.settings as { pipelineStages: { slug: string; name: string }[] })
      .pipelineStages;
    expect(stages[0].slug).toBe("proposal"); // reordered first
    expect(stages.find((s) => s.slug === "qualification")?.name).toBe("Qualifying");
  });

  test("invalid: probability >100 (400), empty (400), no open stage (400)", async () => {
    actAs(crm.owner.authProviderId);
    let res = await updatePipeline(
      req("http://localhost/api/admin/crm/pipeline", "PATCH", {
        stages: [{ ...baseStages[0], defaultProbability: 150 }],
      })
    );
    expect(res.status).toBe(400);
    res = await updatePipeline(
      req("http://localhost/api/admin/crm/pipeline", "PATCH", { stages: [] })
    );
    expect(res.status).toBe(400);
    res = await updatePipeline(
      req("http://localhost/api/admin/crm/pipeline", "PATCH", {
        stages: [{ ...baseStages[2] }], // only a closed stage
      })
    );
    expect(res.status).toBe(400);
  });

  test("deleting a stage that has opportunities is blocked (409)", async () => {
    actAs(crm.owner.authProviderId);
    // Put an opportunity into 'proposal'.
    await testDb.insert(records).values({
      tenantId: crm.tenantId,
      entityTypeId: await entityId("opportunity"),
      data: { name: "Live deal", stage: "proposal" },
    });
    // Attempt to save stages WITHOUT 'proposal'.
    const res = await updatePipeline(
      req("http://localhost/api/admin/crm/pipeline", "PATCH", {
        stages: [baseStages[0], baseStages[2]],
      })
    );
    expect(res.status).toBe(409);
  });

  test("crm.admin gate: member is forbidden (403)", async () => {
    actAs(crm.member.authProviderId);
    const res = await updatePipeline(
      req("http://localhost/api/admin/crm/pipeline", "PATCH", { stages: baseStages })
    );
    expect(res.status).toBe(403);
  });
});
