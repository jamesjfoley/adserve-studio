import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import {
  records,
  recordRelationships,
  schemaRelationships,
} from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import {
  CONTACT_BELONGS_TO_ACCOUNT,
  OPPORTUNITY_HAS_PRIMARY_CONTACT,
} from "@adserve/crm";
import { loadRecordWithRelationships } from "@/lib/crm/relationships";
import {
  setupCrmTenant,
  teardownCrmTenant,
  type CrmTestSetup,
} from "../helpers/crm";

/**
 * WS3 / Condition 7 — `loadRecordWithRelationships` now exposes the relationship
 * edge metadata (`relationshipName`, `metadata`, `isPrimary`) per related entry,
 * and the bound stays at 4 queries (the relationship `name` is a JOIN on the
 * existing edge SELECT, not a 5th round-trip).
 *
 * Uses the privileged `testDb` directly (no RLS GUC), which is sufficient for
 * verifying the loader's grouping/columns; cross-tenant isolation for the
 * relationship tables is proven by crm-relationships-rls.test.ts.
 */

let tenant: CrmTestSetup;
let tokenCounter = 0;
function uniqueToken(): string {
  tokenCounter += 1;
  return `lr-${Date.now().toString(36)}-${tokenCounter}`;
}

async function seed(slug: string, data: Record<string, unknown>): Promise<string> {
  const entity = await getEntityTypeBySlug(testDb, {
    tenantId: tenant.tenantId,
    slug,
  });
  const [row] = await testDb
    .insert(records)
    .values({ tenantId: tenant.tenantId, entityTypeId: entity!.id, data })
    .returning();
  return row.id;
}

async function relId(name: string): Promise<string> {
  const [rel] = await testDb
    .select({ id: schemaRelationships.id })
    .from(schemaRelationships)
    .where(
      and(
        eq(schemaRelationships.tenantId, tenant.tenantId),
        eq(schemaRelationships.name, name)
      )
    );
  return rel.id;
}

async function link(
  name: string,
  source: string,
  target: string,
  metadata: Record<string, unknown> = {}
) {
  await testDb.insert(recordRelationships).values({
    tenantId: tenant.tenantId,
    relationshipId: await relId(name),
    sourceRecordId: source,
    targetRecordId: target,
    metadata,
  });
}

beforeAll(async () => {
  tenant = await setupCrmTenant();
});
afterAll(async () => {
  if (tenant?.tenantId) await teardownCrmTenant(tenant.tenantId);
});

describe("loadRecordWithRelationships — edge metadata (Condition 7)", () => {
  test("each related entry carries relationshipName, metadata, isPrimary", async () => {
    const oppId = await seed("opportunity", {
      name: uniqueToken(),
      stage: "qualification",
    });
    const primaryContact = await seed("contact", {
      firstName: "Pri",
      lastName: uniqueToken(),
      status: "active",
    });
    const otherContact = await seed("contact", {
      firstName: "Sec",
      lastName: uniqueToken(),
      status: "active",
    });
    await link(OPPORTUNITY_HAS_PRIMARY_CONTACT.name, oppId, otherContact, {});
    await link(OPPORTUNITY_HAS_PRIMARY_CONTACT.name, oppId, primaryContact, {
      isPrimary: true,
    });

    const oppEntity = await getEntityTypeBySlug(testDb, {
      tenantId: tenant.tenantId,
      slug: "opportunity",
    });
    const loaded = await loadRecordWithRelationships(testDb, {
      tenantId: tenant.tenantId,
      entityTypeId: oppEntity!.id,
      recordId: oppId,
    });

    expect(loaded).not.toBeNull();
    const contacts = loaded!.relationships.contact ?? [];
    expect(contacts).toHaveLength(2);

    const byId = new Map(contacts.map((c) => [c.id, c]));
    const pri = byId.get(primaryContact)!;
    const sec = byId.get(otherContact)!;
    expect(pri.relationshipName).toBe(OPPORTUNITY_HAS_PRIMARY_CONTACT.name);
    expect(pri.isPrimary).toBe(true);
    expect((pri.metadata as { isPrimary?: boolean }).isPrimary).toBe(true);
    expect(sec.isPrimary).toBe(false);
  });

  test("consumer sorts primary-first using isPrimary", async () => {
    const oppId = await seed("opportunity", {
      name: uniqueToken(),
      stage: "qualification",
    });
    const a = await seed("contact", {
      firstName: "AAA",
      lastName: uniqueToken(),
      status: "active",
    });
    const b = await seed("contact", {
      firstName: "BBB",
      lastName: uniqueToken(),
      status: "active",
    });
    // Link A first (non-primary), then B as primary.
    await link(OPPORTUNITY_HAS_PRIMARY_CONTACT.name, oppId, a, {});
    await link(OPPORTUNITY_HAS_PRIMARY_CONTACT.name, oppId, b, {
      isPrimary: true,
    });

    const oppEntity = await getEntityTypeBySlug(testDb, {
      tenantId: tenant.tenantId,
      slug: "opportunity",
    });
    const loaded = await loadRecordWithRelationships(testDb, {
      tenantId: tenant.tenantId,
      entityTypeId: oppEntity!.id,
      recordId: oppId,
    });
    const contacts = loaded!.relationships.contact ?? [];
    // Mirror the panel's sort: primary first.
    const sorted = [...contacts].sort((x, y) =>
      x.isPrimary === y.isPrimary ? 0 : x.isPrimary ? -1 : 1
    );
    expect(sorted[0].id).toBe(b);
    expect(sorted[0].isPrimary).toBe(true);
  });

  test("query count stays at 4 (record, edges+join, related, entity-types)", async () => {
    const contactId = await seed("contact", {
      firstName: "Q",
      lastName: uniqueToken(),
      status: "active",
    });
    const acc1 = await seed("account", { name: uniqueToken(), status: "active" });
    const acc2 = await seed("account", { name: uniqueToken(), status: "active" });
    await link(CONTACT_BELONGS_TO_ACCOUNT.name, contactId, acc1);
    await link(CONTACT_BELONGS_TO_ACCOUNT.name, contactId, acc2);

    const contactEntity = await getEntityTypeBySlug(testDb, {
      tenantId: tenant.tenantId,
      slug: "contact",
    });

    // Count .select() invocations during the loader call as the query-count
    // proxy. The loader issues exactly 4 selects regardless of how many
    // records are linked (the relationship name is a JOIN on the edge select,
    // never a per-row or a 5th round-trip).
    const selectSpy = vi.spyOn(testDb, "select");
    const before = selectSpy.mock.calls.length;
    await loadRecordWithRelationships(testDb, {
      tenantId: tenant.tenantId,
      entityTypeId: contactEntity!.id,
      recordId: contactId,
    });
    const used = selectSpy.mock.calls.length - before;
    selectSpy.mockRestore();
    expect(used).toBe(4);
  });
});
