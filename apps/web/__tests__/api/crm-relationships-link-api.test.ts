import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import {
  records,
  recordRelationships,
  schemaRelationships,
  auditLog,
} from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import {
  CONTACT_BELONGS_TO_ACCOUNT,
  OPPORTUNITY_BELONGS_TO_ACCOUNT,
  OPPORTUNITY_HAS_PRIMARY_CONTACT,
} from "@adserve/crm";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

/**
 * WS2 — record-to-record link/unlink write API.
 *
 * Runs under the ENFORCED `adserve_app` harness (apps/web vitest env), so the
 * route's `withTenant` queries are subject to RLS exactly as in prod. Fixtures
 * are seeded via the privileged `testDb`. Covers WS2 acceptance criteria 5–10
 * plus the explicitly-required idempotent-duplicate, cardinality-replace,
 * never-two-primaries, permission-or-ownership, and cross-tenant cases.
 */

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import {
  POST as linkRel,
  DELETE as unlinkRel,
} from "@/app/api/crm/[entityType]/[id]/relationships/route";

let tenantA: CrmTestSetup;
let tenantB: CrmTestSetup;
let tokenCounter = 0;

function uniqueToken(): string {
  tokenCounter += 1;
  return `wl-${Date.now().toString(36)}-${tokenCounter}`;
}

function actAs(crm: CrmTestSetup, authProviderId: string) {
  authMock.mockResolvedValue({ userId: authProviderId, orgId: crm.clerkOrgId });
}

function jsonReq(method: string, body: unknown) {
  return new NextRequest("http://localhost", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Insert a record of the given slug for a tenant; returns its id. */
async function seedRecord(
  crm: CrmTestSetup,
  slug: string,
  data: Record<string, unknown>,
  ownedBy?: string
): Promise<string> {
  const entity = await getEntityTypeBySlug(testDb, {
    tenantId: crm.tenantId,
    slug,
  });
  const [row] = await testDb
    .insert(records)
    .values({
      tenantId: crm.tenantId,
      entityTypeId: entity!.id,
      data,
      ownedBy: ownedBy ?? null,
    })
    .returning();
  return row.id;
}

/** The schema-relationship id for a relationship name within a tenant. */
async function relId(crm: CrmTestSetup, name: string): Promise<string> {
  const [rel] = await testDb
    .select({ id: schemaRelationships.id })
    .from(schemaRelationships)
    .where(
      and(
        eq(schemaRelationships.tenantId, crm.tenantId),
        eq(schemaRelationships.name, name)
      )
    );
  return rel.id;
}

/** Count links (optionally only primaries) for a (relationship, source). */
async function countLinks(
  crm: CrmTestSetup,
  relationshipId: string,
  sourceRecordId: string,
  primaryOnly = false
): Promise<number> {
  const rows = await testDb
    .select({ id: recordRelationships.id, metadata: recordRelationships.metadata })
    .from(recordRelationships)
    .where(
      and(
        eq(recordRelationships.relationshipId, relationshipId),
        eq(recordRelationships.sourceRecordId, sourceRecordId)
      )
    );
  if (!primaryOnly) return rows.length;
  return rows.filter(
    (r) => (r.metadata as { isPrimary?: boolean }).isPrimary === true
  ).length;
}

beforeAll(async () => {
  tenantA = await setupCrmTenant();
  tenantB = await setupCrmTenant();
});
afterAll(async () => {
  if (tenantA?.tenantId) await teardownCrmTenant(tenantA.tenantId);
  if (tenantB?.tenantId) await teardownCrmTenant(tenantB.tenantId);
});

const contactsParams = (id: string) => ({
  params: Promise.resolve({ entityType: "contacts", id }),
});
const oppParams = (id: string) => ({
  params: Promise.resolve({ entityType: "opportunities", id }),
});

describe("WS2 — link happy path + idempotency (AC 5, 6)", () => {
  test("POST a valid contact→account link → 201, exactly one row", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const contactId = await seedRecord(tenantA, "contact", {
      firstName: "Fox",
      lastName: uniqueToken(),
      status: "active",
    });
    const accountId = await seedRecord(tenantA, "account", {
      name: uniqueToken(),
      status: "active",
    });

    const res = await linkRel(
      jsonReq("POST", {
        relationshipName: CONTACT_BELONGS_TO_ACCOUNT.name,
        targetRecordId: accountId,
      }),
      contactsParams(contactId)
    );
    expect(res.status).toBe(201);

    const rid = await relId(tenantA, CONTACT_BELONGS_TO_ACCOUNT.name);
    expect(await countLinks(tenantA, rid, contactId)).toBe(1);
  });

  test("POSTing the same (relationshipName, target) again → 200, still one row", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const contactId = await seedRecord(tenantA, "contact", {
      firstName: "Dana",
      lastName: uniqueToken(),
      status: "active",
    });
    const accountId = await seedRecord(tenantA, "account", {
      name: uniqueToken(),
      status: "active",
    });
    const body = {
      relationshipName: CONTACT_BELONGS_TO_ACCOUNT.name,
      targetRecordId: accountId,
    };

    const first = await linkRel(jsonReq("POST", body), contactsParams(contactId));
    expect(first.status).toBe(201);

    const dup = await linkRel(jsonReq("POST", body), contactsParams(contactId));
    expect(dup.status).toBe(200);

    const rid = await relId(tenantA, CONTACT_BELONGS_TO_ACCOUNT.name);
    expect(await countLinks(tenantA, rid, contactId)).toBe(1);
  });

  test("idempotent duplicate POST with isPrimary=true promotes the existing link", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const contactId = await seedRecord(tenantA, "contact", {
      firstName: "P",
      lastName: uniqueToken(),
      status: "active",
    });
    const accountId = await seedRecord(tenantA, "account", {
      name: uniqueToken(),
      status: "active",
    });
    const rid = await relId(tenantA, CONTACT_BELONGS_TO_ACCOUNT.name);

    await linkRel(
      jsonReq("POST", {
        relationshipName: CONTACT_BELONGS_TO_ACCOUNT.name,
        targetRecordId: accountId,
      }),
      contactsParams(contactId)
    );
    // Re-POST as primary → 200, no second row, but now primary.
    const dup = await linkRel(
      jsonReq("POST", {
        relationshipName: CONTACT_BELONGS_TO_ACCOUNT.name,
        targetRecordId: accountId,
        isPrimary: true,
      }),
      contactsParams(contactId)
    );
    expect(dup.status).toBe(200);
    expect(await countLinks(tenantA, rid, contactId)).toBe(1);
    expect(await countLinks(tenantA, rid, contactId, true)).toBe(1);
  });
});

describe("WS2 — cardinality replace for many_to_one (AC 8)", () => {
  test("linking opportunity→account when one exists REPLACES it", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const oppId = await seedRecord(tenantA, "opportunity", {
      name: uniqueToken(),
      stage: "qualification",
    });
    const accountA = await seedRecord(tenantA, "account", {
      name: uniqueToken(),
      status: "active",
    });
    const accountB = await seedRecord(tenantA, "account", {
      name: uniqueToken(),
      status: "active",
    });
    const rid = await relId(tenantA, OPPORTUNITY_BELONGS_TO_ACCOUNT.name);

    const r1 = await linkRel(
      jsonReq("POST", {
        relationshipName: OPPORTUNITY_BELONGS_TO_ACCOUNT.name,
        targetRecordId: accountA,
      }),
      oppParams(oppId)
    );
    expect(r1.status).toBe(201);
    expect(await countLinks(tenantA, rid, oppId)).toBe(1);

    // Link a second account → replaces the first (one row remains).
    const r2 = await linkRel(
      jsonReq("POST", {
        relationshipName: OPPORTUNITY_BELONGS_TO_ACCOUNT.name,
        targetRecordId: accountB,
      }),
      oppParams(oppId)
    );
    expect(r2.status).toBe(201);
    expect(await countLinks(tenantA, rid, oppId)).toBe(1);

    const [remaining] = await testDb
      .select({ targetRecordId: recordRelationships.targetRecordId })
      .from(recordRelationships)
      .where(
        and(
          eq(recordRelationships.relationshipId, rid),
          eq(recordRelationships.sourceRecordId, oppId)
        )
      );
    expect(remaining.targetRecordId).toBe(accountB);
  });
});

describe("WS2 — single-primary invariant (AC 9)", () => {
  test("setting primary on B unsets it on A; never two primaries; unsetting → zero", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const oppId = await seedRecord(tenantA, "opportunity", {
      name: uniqueToken(),
      stage: "qualification",
    });
    const contactA = await seedRecord(tenantA, "contact", {
      firstName: "A",
      lastName: uniqueToken(),
      status: "active",
    });
    const contactB = await seedRecord(tenantA, "contact", {
      firstName: "B",
      lastName: uniqueToken(),
      status: "active",
    });
    const rid = await relId(tenantA, OPPORTUNITY_HAS_PRIMARY_CONTACT.name);

    // Link A as primary.
    await linkRel(
      jsonReq("POST", {
        relationshipName: OPPORTUNITY_HAS_PRIMARY_CONTACT.name,
        targetRecordId: contactA,
        isPrimary: true,
      }),
      oppParams(oppId)
    );
    expect(await countLinks(tenantA, rid, oppId, true)).toBe(1);

    // Link B as primary → A is demoted; still exactly one primary, and it's B.
    await linkRel(
      jsonReq("POST", {
        relationshipName: OPPORTUNITY_HAS_PRIMARY_CONTACT.name,
        targetRecordId: contactB,
        isPrimary: true,
      }),
      oppParams(oppId)
    );
    expect(await countLinks(tenantA, rid, oppId)).toBe(2);
    expect(await countLinks(tenantA, rid, oppId, true)).toBe(1);

    const primaries = await testDb
      .select({ targetRecordId: recordRelationships.targetRecordId })
      .from(recordRelationships)
      .where(
        and(
          eq(recordRelationships.relationshipId, rid),
          eq(recordRelationships.sourceRecordId, oppId),
          sql`(${recordRelationships.metadata}->>'isPrimary')::boolean = true`
        )
      );
    expect(primaries).toHaveLength(1);
    expect(primaries[0].targetRecordId).toBe(contactB);

    // Unsetting the primary (delete B) leaves zero primaries — allowed.
    await unlinkRel(
      jsonReq("DELETE", {
        relationshipName: OPPORTUNITY_HAS_PRIMARY_CONTACT.name,
        targetRecordId: contactB,
      }),
      oppParams(oppId)
    );
    expect(await countLinks(tenantA, rid, oppId, true)).toBe(0);
    expect(await countLinks(tenantA, rid, oppId)).toBe(1);
  });
});

describe("WS2 — unlink semantics (AC 7)", () => {
  test("DELETE removes only the targeted link; unlinking the sole link is allowed", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const contactId = await seedRecord(tenantA, "contact", {
      firstName: "Sole",
      lastName: uniqueToken(),
      status: "active",
    });
    const accountX = await seedRecord(tenantA, "account", {
      name: uniqueToken(),
      status: "active",
    });
    const accountY = await seedRecord(tenantA, "account", {
      name: uniqueToken(),
      status: "active",
    });
    const rid = await relId(tenantA, CONTACT_BELONGS_TO_ACCOUNT.name);

    for (const acc of [accountX, accountY]) {
      await linkRel(
        jsonReq("POST", {
          relationshipName: CONTACT_BELONGS_TO_ACCOUNT.name,
          targetRecordId: acc,
        }),
        contactsParams(contactId)
      );
    }
    expect(await countLinks(tenantA, rid, contactId)).toBe(2);

    // DELETE only X.
    const delX = await unlinkRel(
      jsonReq("DELETE", {
        relationshipName: CONTACT_BELONGS_TO_ACCOUNT.name,
        targetRecordId: accountX,
      }),
      contactsParams(contactId)
    );
    expect(delX.status).toBe(200);
    expect(await countLinks(tenantA, rid, contactId)).toBe(1);

    // DELETE the sole remaining link → allowed, record left orphaned.
    const delY = await unlinkRel(
      jsonReq("DELETE", {
        relationshipName: CONTACT_BELONGS_TO_ACCOUNT.name,
        targetRecordId: accountY,
      }),
      contactsParams(contactId)
    );
    expect(delY.status).toBe(200);
    expect(await countLinks(tenantA, rid, contactId)).toBe(0);
  });
});

describe("WS2 — permission-or-ownership (Condition 4)", () => {
  test("owner-member without .update CAN link a record they own", async () => {
    // The member role lacks contact.update; give the member OWNERSHIP of the
    // owning (contact) record.
    actAs(tenantA, tenantA.member.authProviderId);
    const contactId = await seedRecord(
      tenantA,
      "contact",
      { firstName: "Owned", lastName: uniqueToken(), status: "active" },
      tenantA.member.id
    );
    const accountId = await seedRecord(tenantA, "account", {
      name: uniqueToken(),
      status: "active",
    });

    const res = await linkRel(
      jsonReq("POST", {
        relationshipName: CONTACT_BELONGS_TO_ACCOUNT.name,
        targetRecordId: accountId,
      }),
      contactsParams(contactId)
    );
    expect(res.status).toBe(201);
  });

  test("non-owning member lacking .update gets 403", async () => {
    // Owning record owned by the OWNER, acted on by the member.
    const contactId = await seedRecord(
      tenantA,
      "contact",
      { firstName: "NotMine", lastName: uniqueToken(), status: "active" },
      tenantA.owner.id
    );
    const accountId = await seedRecord(tenantA, "account", {
      name: uniqueToken(),
      status: "active",
    });

    actAs(tenantA, tenantA.member.authProviderId);
    const res = await linkRel(
      jsonReq("POST", {
        relationshipName: CONTACT_BELONGS_TO_ACCOUNT.name,
        targetRecordId: accountId,
      }),
      contactsParams(contactId)
    );
    expect(res.status).toBe(403);
  });
});

describe("WS2 — cross-tenant RLS isolation (MANDATORY)", () => {
  test("caller in A linking to a target in B → 404, no cross-tenant row", async () => {
    // Owning contact in A; target account in B.
    const contactId = await seedRecord(tenantA, "contact", {
      firstName: "Cross",
      lastName: uniqueToken(),
      status: "active",
    });
    const foreignAccount = await seedRecord(tenantB, "account", {
      name: uniqueToken(),
      status: "active",
    });

    actAs(tenantA, tenantA.owner.authProviderId);
    const res = await linkRel(
      jsonReq("POST", {
        relationshipName: CONTACT_BELONGS_TO_ACCOUNT.name,
        targetRecordId: foreignAccount,
      }),
      contactsParams(contactId)
    );
    expect(res.status).toBe(404);

    // No cross-tenant link was created (privileged read across both tenants).
    const rows = await testDb
      .select({ id: recordRelationships.id })
      .from(recordRelationships)
      .where(eq(recordRelationships.targetRecordId, foreignAccount));
    expect(rows).toHaveLength(0);
  });
});

describe("WS2 — audit rows inside the tx (AC 10)", () => {
  test("a link and an unlink each write a relationship audit_log row", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const contactId = await seedRecord(tenantA, "contact", {
      firstName: "Aud",
      lastName: uniqueToken(),
      status: "active",
    });
    const accountId = await seedRecord(tenantA, "account", {
      name: uniqueToken(),
      status: "active",
    });

    const linkRes = await linkRel(
      jsonReq("POST", {
        relationshipName: CONTACT_BELONGS_TO_ACCOUNT.name,
        targetRecordId: accountId,
      }),
      contactsParams(contactId)
    );
    const linkId = (await linkRes.json()).linkId as string;

    const linkAudit = await testDb
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tenantId, tenantA.tenantId),
          eq(auditLog.action, "link"),
          eq(auditLog.resourceType, "relationship"),
          eq(auditLog.resourceId, linkId)
        )
      );
    expect(linkAudit).toHaveLength(1);

    await unlinkRel(
      jsonReq("DELETE", {
        relationshipName: CONTACT_BELONGS_TO_ACCOUNT.name,
        targetRecordId: accountId,
      }),
      contactsParams(contactId)
    );
    const unlinkAudit = await testDb
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tenantId, tenantA.tenantId),
          eq(auditLog.action, "unlink"),
          eq(auditLog.resourceType, "relationship"),
          eq(auditLog.resourceId, linkId)
        )
      );
    expect(unlinkAudit).toHaveLength(1);
  });
});
