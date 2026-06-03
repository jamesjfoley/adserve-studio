import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { testDb } from "@adserve/database/test-helpers";
import { schemaRelationships } from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

// DB-level UNIQUE(tenant_id, name) on the relationships registry
// (sql/008-unique-relationship-name.sql). Requires that migration to be applied
// to the local DB the harness runs against.

let A: CrmTestSetup;
let B: CrmTestSetup;

async function entityIds(tenantId: string) {
  const account = await getEntityTypeBySlug(testDb, { tenantId, slug: "account" });
  const contact = await getEntityTypeBySlug(testDb, { tenantId, slug: "contact" });
  return { src: account!.id, tgt: contact!.id };
}

beforeAll(async () => {
  A = await setupCrmTenant();
  B = await setupCrmTenant();
});
afterAll(async () => {
  // Tenant teardown cascades to the relationships rows inserted below.
  if (A?.tenantId) await teardownCrmTenant(A.tenantId);
  if (B?.tenantId) await teardownCrmTenant(B.tenantId);
});

describe("relationships UNIQUE(tenant_id, name)", () => {
  test("rejects a second registry row with the same (tenant_id, name)", async () => {
    const { src, tgt } = await entityIds(A.tenantId);
    const row = {
      tenantId: A.tenantId,
      name: "hardening_dup_check",
      sourceEntityTypeId: src,
      targetEntityTypeId: tgt,
      relationshipType: "many_to_many" as const,
    };

    await testDb.insert(schemaRelationships).values(row); // first insert ok
    // Duplicate (same tenant + name) violates the unique index.
    await expect(
      testDb.insert(schemaRelationships).values(row)
    ).rejects.toThrow(/idx_relationships_tenant_name|duplicate key|unique/i);
  });

  test("allows the same name under a DIFFERENT tenant (constraint is tenant-scoped)", async () => {
    const a = await entityIds(A.tenantId);
    const b = await entityIds(B.tenantId);
    const name = "hardening_scoped_check";

    await testDb.insert(schemaRelationships).values({
      tenantId: A.tenantId,
      name,
      sourceEntityTypeId: a.src,
      targetEntityTypeId: a.tgt,
      relationshipType: "many_to_one" as const,
    });

    // Same name, different tenant — permitted.
    await expect(
      testDb.insert(schemaRelationships).values({
        tenantId: B.tenantId,
        name,
        sourceEntityTypeId: b.src,
        targetEntityTypeId: b.tgt,
        relationshipType: "many_to_one" as const,
      })
    ).resolves.toBeDefined();
  });
});
