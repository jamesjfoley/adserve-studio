import { afterAll, describe, expect, test } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  setupTestContext,
  testClient,
  withTestTransaction,
} from "@adserve/database/test-helpers";
import {
  recordRelationships,
  records,
  schemaRelationships,
} from "@adserve/database";
import { activateCrmForTenant } from "../src/activate";
import {
  CRM_RELATIONSHIPS,
  CONTACT_BELONGS_TO_ACCOUNT,
  OPPORTUNITY_BELONGS_TO_ACCOUNT,
  OPPORTUNITY_HAS_PRIMARY_CONTACT,
} from "../src/relationships";
import { CRM_PERMISSIONS } from "../src/permissions";

/**
 * WS1 — relationship cardinality reconciliation (sql/007).
 *
 * These tests exercise the DATA LOGIC of the in-place enum flip and its
 * idempotency under the privileged test harness (withTestTransaction →
 * superuser testClient, RLS bypassed) — the same harness activate-crm.test.ts
 * uses. The migration's RLS-bypass GUC correctness under the ENFORCED
 * adserve_app role is proven separately in the web cross-tenant test
 * (apps/web/__tests__/api/crm-relationships-rls.test.ts).
 *
 * The production sql/007 UPDATE is intentionally UNSCOPED by tenant
 * (`WHERE name IN (...)` only). To keep these tests hermetic under parallel
 * execution, the in-test UPDATE additionally constrains `tenant_id` to this
 * test's tenant — the WHERE-clause shape that matters (name + the
 * many_to_one idempotency predicate) is preserved exactly.
 */

afterAll(async () => {
  await testClient.end();
});

const M2M_NAMES = [
  "contact_belongs_to_account",
  "opportunity_has_primary_contact",
];

/** The exact sql/007 predicate, scoped to one tenant for test hermeticity. */
async function runReconcile(
  tx: Parameters<Parameters<typeof withTestTransaction>[0]>[0],
  tenantId: string
): Promise<void> {
  await tx.execute(sql`
    UPDATE relationships
       SET relationship_type = 'many_to_many'
     WHERE tenant_id = ${tenantId}
       AND name IN ('contact_belongs_to_account', 'opportunity_has_primary_contact')
       AND relationship_type = 'many_to_one'
  `);
}

describe("WS1 — cardinality reconciliation (sql/007)", () => {
  test("acceptance 2 (regression guard, Condition 1): constants + name slugs unchanged", () => {
    // The convert route imports these constants and resolves the relationship
    // row by `.name`. A rename would silently drop the opp↔contact link.
    expect(OPPORTUNITY_HAS_PRIMARY_CONTACT.name).toBe(
      "opportunity_has_primary_contact"
    );
    expect(CONTACT_BELONGS_TO_ACCOUNT.name).toBe("contact_belongs_to_account");
    expect(OPPORTUNITY_BELONGS_TO_ACCOUNT.name).toBe(
      "opportunity_belongs_to_account"
    );

    // Spec-level cardinality. contact_belongs_to_account is now the PRIMARY
    // many_to_one (the multi-account case moved to contact_related_to_account);
    // sql/007 historically flipped prod to many_to_many, and the prod re-flip
    // to many_to_one is gated migration 010. opportunity↔contact stays
    // many_to_many; opportunity↔account stays many_to_one.
    expect(CONTACT_BELONGS_TO_ACCOUNT.cardinality).toBe("many_to_one");
    expect(OPPORTUNITY_HAS_PRIMARY_CONTACT.cardinality).toBe("many_to_many");
    expect(OPPORTUNITY_BELONGS_TO_ACCOUNT.cardinality).toBe("many_to_one");

    // Permission matrix is untouched by WS1 — stays at 22.
    expect(CRM_PERMISSIONS).toHaveLength(22);
  });

  test("acceptance 3: in-place flip on a pre-existing tenant, then idempotent + activation-safe", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);

      // Activate, then force the two rows BACK to many_to_one to simulate a
      // tenant provisioned before WS1 shipped.
      await activateCrmForTenant(tx, { tenantId: tenant.id });
      await tx
        .update(schemaRelationships)
        .set({ relationshipType: "many_to_one" })
        .where(
          and(
            eq(schemaRelationships.tenantId, tenant.id),
            sql`${schemaRelationships.name} IN ('contact_belongs_to_account','opportunity_has_primary_contact')`
          )
        );

      // Sanity: both are many_to_one pre-migration.
      const pre = await tx
        .select()
        .from(schemaRelationships)
        .where(eq(schemaRelationships.tenantId, tenant.id));
      const preByName = new Map(pre.map((r) => [r.name, r.relationshipType]));
      expect(preByName.get("contact_belongs_to_account")).toBe("many_to_one");
      expect(preByName.get("opportunity_has_primary_contact")).toBe(
        "many_to_one"
      );
      expect(preByName.get("opportunity_belongs_to_account")).toBe(
        "many_to_one"
      );

      // First migration run flips both.
      await runReconcile(tx, tenant.id);
      const afterFirst = await tx
        .select()
        .from(schemaRelationships)
        .where(eq(schemaRelationships.tenantId, tenant.id));
      const firstByName = new Map(
        afterFirst.map((r) => [r.name, r.relationshipType])
      );
      expect(firstByName.get("contact_belongs_to_account")).toBe(
        "many_to_many"
      );
      expect(firstByName.get("opportunity_has_primary_contact")).toBe(
        "many_to_many"
      );
      // opportunity_belongs_to_account is NOT in the predicate → unchanged.
      expect(firstByName.get("opportunity_belongs_to_account")).toBe(
        "many_to_one"
      );

      // Second run is idempotent: the `AND relationship_type = 'many_to_one'`
      // predicate matches nothing now; no error, no change.
      await runReconcile(tx, tenant.id);
      const afterSecond = await tx
        .select()
        .from(schemaRelationships)
        .where(eq(schemaRelationships.tenantId, tenant.id));
      const secondByName = new Map(
        afterSecond.map((r) => [r.name, r.relationshipType])
      );
      expect(secondByName.get("contact_belongs_to_account")).toBe(
        "many_to_many"
      );
      expect(secondByName.get("opportunity_has_primary_contact")).toBe(
        "many_to_many"
      );

      // Re-running activation after the flip must NOT duplicate: the spec now
      // declares many_to_many, so activate's existing-row check (keyed on
      // relationshipType) finds the flipped row and skips.
      const reactivate = await activateCrmForTenant(tx, {
        tenantId: tenant.id,
      });
      expect(reactivate.relationshipsCreated).toBe(0);

      // Exactly one registry row per relationship name for this tenant.
      const finalRels = await tx
        .select()
        .from(schemaRelationships)
        .where(eq(schemaRelationships.tenantId, tenant.id));
      expect(finalRels).toHaveLength(CRM_RELATIONSHIPS.length);
      for (const name of [...M2M_NAMES, "opportunity_belongs_to_account"]) {
        expect(finalRels.filter((r) => r.name === name)).toHaveLength(1);
      }
    });
  });

  test("acceptance 1: fresh activation already yields the reconciled cardinality (migration is a no-op)", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      await activateCrmForTenant(tx, { tenantId: tenant.id });

      // A clean tenant already activates as many_to_many for the two specs, so
      // the migration's many_to_one predicate matches zero rows here.
      await runReconcile(tx, tenant.id);

      const rels = await tx
        .select()
        .from(schemaRelationships)
        .where(eq(schemaRelationships.tenantId, tenant.id));
      const byName = new Map(rels.map((r) => [r.name, r.relationshipType]));
      expect(byName.get("contact_belongs_to_account")).toBe("many_to_many");
      expect(byName.get("opportunity_has_primary_contact")).toBe(
        "many_to_many"
      );
      expect(byName.get("opportunity_belongs_to_account")).toBe("many_to_one");

      // Slug for opportunity_has_primary_contact is unchanged (acceptance 1).
      expect(
        rels.some((r) => r.name === "opportunity_has_primary_contact")
      ).toBe(true);
    });
  });

  test("acceptance 4: junction row count + FK integrity unchanged across the migration", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const result = await activateCrmForTenant(tx, { tenantId: tenant.id });

      // Reset to many_to_one to make the migration actually fire.
      await tx
        .update(schemaRelationships)
        .set({ relationshipType: "many_to_one" })
        .where(
          and(
            eq(schemaRelationships.tenantId, tenant.id),
            sql`${schemaRelationships.name} IN ('contact_belongs_to_account','opportunity_has_primary_contact')`
          )
        );

      // Seed real junction links on the contact_belongs_to_account relationship.
      const [contactAccountRel] = await tx
        .select()
        .from(schemaRelationships)
        .where(
          and(
            eq(schemaRelationships.tenantId, tenant.id),
            eq(schemaRelationships.name, "contact_belongs_to_account")
          )
        );

      const [account] = await tx
        .insert(records)
        .values({
          tenantId: tenant.id,
          entityTypeId: result.entityTypeIds.account,
          data: { name: "Acme", status: "active" },
        })
        .returning();

      const contactIds: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const [c] = await tx
          .insert(records)
          .values({
            tenantId: tenant.id,
            entityTypeId: result.entityTypeIds.contact,
            data: { firstName: "C", lastName: String(i), status: "active" },
          })
          .returning();
        contactIds.push(c.id);
        await tx.insert(recordRelationships).values({
          tenantId: tenant.id,
          relationshipId: contactAccountRel.id,
          sourceRecordId: c.id,
          targetRecordId: account.id,
        });
      }

      async function junctionRows() {
        return tx
          .select()
          .from(recordRelationships)
          .where(eq(recordRelationships.tenantId, tenant.id));
      }

      const before = await junctionRows();
      expect(before).toHaveLength(3);
      const beforeIds = new Set(before.map((r) => r.id));
      const beforeRelId = before[0].relationshipId;

      // Run the migration.
      await runReconcile(tx, tenant.id);

      const after = await junctionRows();
      // Same count, same rows (in-place UPDATE on `relationships`, not the
      // junction → no rewrite, no orphan).
      expect(after).toHaveLength(3);
      expect(new Set(after.map((r) => r.id))).toEqual(beforeIds);

      // The relationship_id FK still points at the SAME (now flipped) row.
      expect(after.every((r) => r.relationshipId === beforeRelId)).toBe(true);

      // Every junction relationship_id references a live relationships row.
      const liveRelIds = new Set(
        (
          await tx
            .select({ id: schemaRelationships.id })
            .from(schemaRelationships)
            .where(eq(schemaRelationships.tenantId, tenant.id))
        ).map((r) => r.id)
      );
      expect(after.every((r) => liveRelIds.has(r.relationshipId))).toBe(true);

      // And the row it points at is now many_to_many.
      const [flipped] = await tx
        .select()
        .from(schemaRelationships)
        .where(eq(schemaRelationships.id, beforeRelId));
      expect(flipped.relationshipType).toBe("many_to_many");
    });
  });

  test("acceptance 3b: re-activation is idempotent ACROSS a cardinality mismatch (no duplicate registry row)", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);

      // Fresh activation: spec is many_to_many for the two M2M relationships.
      await activateCrmForTenant(tx, { tenantId: tenant.id });

      // Simulate the pre-migration / old-code-written state for ONE M2M
      // relationship: force the stored row back to many_to_one. The spec still
      // computes many_to_many, so the stored value now MISMATCHES the spec.
      await tx
        .update(schemaRelationships)
        .set({ relationshipType: "many_to_one" })
        .where(
          and(
            eq(schemaRelationships.tenantId, tenant.id),
            eq(schemaRelationships.name, "contact_belongs_to_account")
          )
        );

      // Re-run activation. The OLD value-sensitive check (which keyed on
      // relationship_type) would NOT find the stored many_to_one row when the
      // spec computes many_to_many, and would insert a SECOND row. The new
      // natural-key (tenantId, name) match finds it and skips.
      const reactivate = await activateCrmForTenant(tx, {
        tenantId: tenant.id,
      });
      expect(reactivate.relationshipsCreated).toBe(0);

      // Exactly ONE registry row for (tenantId, contact_belongs_to_account)
      // — no duplicate from the mismatch window.
      const mismatched = await tx
        .select()
        .from(schemaRelationships)
        .where(
          and(
            eq(schemaRelationships.tenantId, tenant.id),
            eq(schemaRelationships.name, "contact_belongs_to_account")
          )
        );
      expect(mismatched).toHaveLength(1);

      // Activation is skip-on-match: it does NOT reconcile the stored value.
      // The row keeps its forced many_to_one (the migration owns the flip).
      expect(mismatched[0].relationshipType).toBe("many_to_one");

      // And the total registry remains one row per relationship name.
      const finalRels = await tx
        .select()
        .from(schemaRelationships)
        .where(eq(schemaRelationships.tenantId, tenant.id));
      expect(finalRels).toHaveLength(CRM_RELATIONSHIPS.length);
      for (const name of [...M2M_NAMES, "opportunity_belongs_to_account"]) {
        expect(finalRels.filter((r) => r.name === name)).toHaveLength(1);
      }
    });
  });
});
