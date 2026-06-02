import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  records,
  recordRelationships,
  schemaRelationships,
  withSuperAdminBypass,
  withTenant,
} from "@adserve/database";
import { testDb } from "@adserve/database/test-helpers";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { CONTACT_BELONGS_TO_ACCOUNT } from "@adserve/crm";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

/**
 * WS1 — RLS coverage for record_relationships + the sql/007 bypass-GUC, under
 * the ENFORCED adserve_app harness.
 *
 * App-client queries (withTenant / withSuperAdminBypass / db.transaction) run
 * as the NOBYPASSRLS `adserve_app` role here (apps/web vitest env DATABASE_URL),
 * so RLS ACTUALLY ENFORCES — mirroring prod. Fixtures are seeded via the
 * privileged `testDb`. These assertions are LOAD-BEARING: under a superuser
 * connection they would pass trivially; under adserve_app they prove the policy
 * gates the data and that the migration's bypass GUC is what makes the
 * cross-tenant UPDATE work.
 */

let tenantA: CrmTestSetup;
let tenantB: CrmTestSetup;

/** Seed one contact→account link for a tenant; returns the junction row id. */
async function seedLink(crm: CrmTestSetup): Promise<{
  linkId: string;
  relationshipId: string;
}> {
  const accountEntity = await getEntityTypeBySlug(testDb, {
    tenantId: crm.tenantId,
    slug: "account",
  });
  const contactEntity = await getEntityTypeBySlug(testDb, {
    tenantId: crm.tenantId,
    slug: "contact",
  });
  const [rel] = await testDb
    .select()
    .from(schemaRelationships)
    .where(
      and(
        eq(schemaRelationships.tenantId, crm.tenantId),
        eq(schemaRelationships.name, CONTACT_BELONGS_TO_ACCOUNT.name)
      )
    );
  const [account] = await testDb
    .insert(records)
    .values({
      tenantId: crm.tenantId,
      entityTypeId: accountEntity!.id,
      data: { name: "RLS Co", status: "active" },
    })
    .returning();
  const [contact] = await testDb
    .insert(records)
    .values({
      tenantId: crm.tenantId,
      entityTypeId: contactEntity!.id,
      data: { firstName: "R", lastName: "LS", status: "active" },
    })
    .returning();
  const [link] = await testDb
    .insert(recordRelationships)
    .values({
      tenantId: crm.tenantId,
      relationshipId: rel.id,
      sourceRecordId: contact.id,
      targetRecordId: account.id,
    })
    .returning();
  return { linkId: link.id, relationshipId: rel.id };
}

beforeEach(async () => {
  tenantA = await setupCrmTenant();
  tenantB = await setupCrmTenant();
});
afterEach(async () => {
  if (tenantA?.tenantId) await teardownCrmTenant(tenantA.tenantId);
  if (tenantB?.tenantId) await teardownCrmTenant(tenantB.tenantId);
});

describe("WS1 — record_relationships cross-tenant RLS isolation (adserve_app)", () => {
  test("withTenant(A) sees only A's links; empty context sees zero; bypass sees both", async () => {
    const a = await seedLink(tenantA);
    const b = await seedLink(tenantB);

    // withTenant(A) returns ONLY A's link.
    const scopedA = await withTenant(tenantA.tenantId, (tx) =>
      tx.select({ id: recordRelationships.id }).from(recordRelationships)
    );
    const scopedAIds = scopedA.map((r) => r.id);
    expect(scopedAIds).toContain(a.linkId);
    expect(scopedAIds).not.toContain(b.linkId);

    // A missing/empty tenant context → ZERO rows (NULLIF guard → NULL, never
    // another tenant's). A bare transaction sets no app.current_tenant_id.
    const noContext = await db.transaction((tx) =>
      tx
        .select({ id: recordRelationships.id })
        .from(recordRelationships)
        .where(inArray(recordRelationships.id, [a.linkId, b.linkId]))
    );
    expect(noContext).toHaveLength(0);

    // CONTROL: bypass sees BOTH tenants' links — proves the policy gates the
    // data (not app-side filtering), and is the mechanism sql/007 relies on.
    const bypass = await withSuperAdminBypass((tx) =>
      tx
        .select({ id: recordRelationships.id })
        .from(recordRelationships)
        .where(inArray(recordRelationships.id, [a.linkId, b.linkId]))
    );
    const bypassIds = bypass.map((r) => r.id);
    expect(bypassIds).toContain(a.linkId);
    expect(bypassIds).toContain(b.linkId);
  });
});

describe("WS1 — sql/007 bypass-GUC is load-bearing under enforced RLS", () => {
  test("cross-tenant UPDATE no-ops without the GUC and flips both tenants with it", async () => {
    await seedLink(tenantA);
    await seedLink(tenantB);

    // Force both tenants' two M2M relationship rows back to many_to_one to
    // simulate pre-WS1 state (seed via the privileged testDb).
    await testDb
      .update(schemaRelationships)
      .set({ relationshipType: "many_to_one" })
      .where(
        and(
          inArray(schemaRelationships.tenantId, [
            tenantA.tenantId,
            tenantB.tenantId,
          ]),
          sql`${schemaRelationships.name} IN ('contact_belongs_to_account','opportunity_has_primary_contact')`
        )
      );

    // Attempt the EXACT sql/007 UPDATE under adserve_app WITHOUT the bypass
    // GUC and with NO tenant context. The NULLIF guard → NULL means the policy
    // matches zero rows → the UPDATE silently no-ops (the prod failure mode the
    // GUC exists to prevent).
    const noBypass = await db.transaction((tx) =>
      tx.execute(sql`
        UPDATE relationships
           SET relationship_type = 'many_to_many'
         WHERE name IN ('contact_belongs_to_account', 'opportunity_has_primary_contact')
           AND relationship_type = 'many_to_one'
      `)
    );
    expect(noBypass.count).toBe(0);

    // Still many_to_one for both tenants (proven via privileged read).
    const afterNoBypass = await testDb
      .select()
      .from(schemaRelationships)
      .where(
        inArray(schemaRelationships.tenantId, [
          tenantA.tenantId,
          tenantB.tenantId,
        ])
      );
    expect(
      afterNoBypass
        .filter((r) => r.name === "contact_belongs_to_account")
        .every((r) => r.relationshipType === "many_to_one")
    ).toBe(true);

    // Now run sql/007 AS WRITTEN: SET LOCAL app.bypass_rls = 'on' then UPDATE.
    // The cross-tenant UPDATE now flips rows for BOTH tenants.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.bypass_rls = 'on'`);
      await tx.execute(sql`
        UPDATE relationships
           SET relationship_type = 'many_to_many'
         WHERE name IN ('contact_belongs_to_account', 'opportunity_has_primary_contact')
           AND relationship_type = 'many_to_one'
      `);
    });

    const afterBypass = await testDb
      .select()
      .from(schemaRelationships)
      .where(
        inArray(schemaRelationships.tenantId, [
          tenantA.tenantId,
          tenantB.tenantId,
        ])
      );
    for (const tid of [tenantA.tenantId, tenantB.tenantId]) {
      const forTenant = afterBypass.filter((r) => r.tenantId === tid);
      const byName = new Map(
        forTenant.map((r) => [r.name, r.relationshipType])
      );
      expect(byName.get("contact_belongs_to_account")).toBe("many_to_many");
      expect(byName.get("opportunity_has_primary_contact")).toBe(
        "many_to_many"
      );
      // opportunity_belongs_to_account is not in the predicate → unchanged.
      expect(byName.get("opportunity_belongs_to_account")).toBe("many_to_one");
    }
  });
});
