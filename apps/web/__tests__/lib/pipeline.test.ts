import { afterAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import {
  setupTestContext,
  testClient,
  withTestTransaction,
} from "@adserve/database/test-helpers";
import {
  entityTypes,
  recordRelationships,
  records,
  schemaRelationships,
  type db,
} from "@adserve/database";
import { activateCrmForTenant } from "@adserve/crm";
import { loadPipelineBoard } from "@/lib/crm/pipeline";

afterAll(async () => {
  await testClient.end();
});

type Tx = typeof db;

async function setup(tx: Tx) {
  const { tenant, user } = await setupTestContext(tx);
  await activateCrmForTenant(tx, { tenantId: tenant.id });

  const types = await tx
    .select({ id: entityTypes.id, slug: entityTypes.slug })
    .from(entityTypes)
    .where(eq(entityTypes.tenantId, tenant.id));
  const typeId = (slug: string) => types.find((t) => t.slug === slug)!.id;

  const rels = await tx
    .select({ id: schemaRelationships.id, name: schemaRelationships.name })
    .from(schemaRelationships)
    .where(eq(schemaRelationships.tenantId, tenant.id));
  const relId = (name: string) => rels.find((r) => r.name === name)!.id;

  return {
    tenantId: tenant.id,
    userId: user.id,
    oppType: typeId("opportunity"),
    campaignType: typeId("campaign"),
    accountType: typeId("account"),
    contactType: typeId("contact"),
    acctRel: relId("opportunity_belongs_to_account"),
    contactRel: relId("opportunity_has_primary_contact"),
    campaignAcctRel: relId("campaign_belongs_to_account"),
  };
}

async function insertRecord(
  tx: Tx,
  tenantId: string,
  entityTypeId: string,
  data: Record<string, unknown>,
  opts: { ownedBy?: string; archived?: boolean } = {}
) {
  const [row] = await tx
    .insert(records)
    .values({
      tenantId,
      entityTypeId,
      data,
      ownedBy: opts.ownedBy ?? null,
      isArchived: opts.archived ?? false,
    })
    .returning({ id: records.id });
  return row.id;
}

function amount(n: number) {
  return { amount: n, currency: "GBP" };
}

describe("loadPipelineBoard", () => {
  test("groups opportunities by stage, columns ordered by displayOrder", async () => {
    await withTestTransaction(async (tx) => {
      const s = await setup(tx);
      await insertRecord(tx, s.tenantId, s.oppType, {
        name: "A",
        stage: "qualification",
        amount: amount(1000),
      });
      await insertRecord(tx, s.tenantId, s.oppType, {
        name: "B",
        stage: "proposal",
        amount: amount(5000),
      });

      const board = await loadPipelineBoard(tx, { tenantId: s.tenantId });
      expect(board).not.toBeNull();
      expect(board!.columns.map((c) => c.slug)).toEqual([
        "qualification",
        "needs_analysis",
        "proposal",
        "negotiation",
        "closed_won",
        "closed_lost",
      ]);
      const qual = board!.columns.find((c) => c.slug === "qualification")!;
      expect(qual.count).toBe(1);
      expect(qual.total).toBe(1000);
      const proposal = board!.columns.find((c) => c.slug === "proposal")!;
      expect(proposal.count).toBe(1);
      expect(proposal.total).toBe(5000);
    });
  });

  test("resolves the ACCOUNT name, never the primary contact (non-conflation)", async () => {
    await withTestTransaction(async (tx) => {
      const s = await setup(tx);
      const oppId = await insertRecord(tx, s.tenantId, s.oppType, {
        name: "Deal",
        stage: "qualification",
      });
      const accId = await insertRecord(tx, s.tenantId, s.accountType, {
        name: "Acme Ltd",
      });
      const contactId = await insertRecord(tx, s.tenantId, s.contactType, {
        name: "Jane Contact",
      });
      // The opportunity is related to BOTH an account and a primary contact.
      await tx.insert(recordRelationships).values([
        {
          tenantId: s.tenantId,
          relationshipId: s.acctRel,
          sourceRecordId: oppId,
          targetRecordId: accId,
        },
        {
          tenantId: s.tenantId,
          relationshipId: s.contactRel,
          sourceRecordId: oppId,
          targetRecordId: contactId,
        },
      ]);

      const board = await loadPipelineBoard(tx, { tenantId: s.tenantId });
      const card = board!.columns
        .find((c) => c.slug === "qualification")!
        .cards.find((c) => c.id === oppId)!;
      expect(card.accountName).toBe("Acme Ltd");
      expect(card.accountName).not.toBe("Jane Contact");
    });
  });

  test("buckets unknown/missing-stage opportunities into __other__", async () => {
    await withTestTransaction(async (tx) => {
      const s = await setup(tx);
      await insertRecord(tx, s.tenantId, s.oppType, {
        name: "Weird",
        stage: "not_a_stage",
        amount: amount(200),
      });
      await insertRecord(tx, s.tenantId, s.oppType, { name: "NoStage" });

      const board = await loadPipelineBoard(tx, { tenantId: s.tenantId });
      const other = board!.columns.find((c) => c.slug === "__other__")!;
      expect(other).toBeDefined();
      expect(other.name).toBe("Other");
      expect(other.count).toBe(2);
      expect(other.total).toBe(200);
    });
  });

  test("excludes archived opportunities", async () => {
    await withTestTransaction(async (tx) => {
      const s = await setup(tx);
      await insertRecord(
        tx,
        s.tenantId,
        s.oppType,
        { name: "Gone", stage: "qualification" },
        { archived: true }
      );
      const board = await loadPipelineBoard(tx, { tenantId: s.tenantId });
      const qual = board!.columns.find((c) => c.slug === "qualification")!;
      expect(qual.count).toBe(0);
    });
  });

  test("campaign board uses CAMPAIGN_STAGES and sums the `value` field", async () => {
    await withTestTransaction(async (tx) => {
      const s = await setup(tx);
      await insertRecord(tx, s.tenantId, s.campaignType, {
        name: "Spring push",
        stage: "planning",
        value: amount(8000),
      });
      await insertRecord(tx, s.tenantId, s.campaignType, {
        name: "Summer",
        stage: "live",
        value: amount(2000),
      });
      // An opportunity must NOT appear on the campaign board (separate stage set).
      await insertRecord(tx, s.tenantId, s.oppType, {
        name: "An opp",
        stage: "qualification",
        amount: amount(9999),
      });

      const board = await loadPipelineBoard(tx, {
        tenantId: s.tenantId,
        entity: "campaign",
      });
      expect(board).not.toBeNull();
      expect(board!.columns.map((c) => c.slug)).toEqual([
        "brief",
        "planning",
        "booking",
        "live",
        "pca",
        "lost",
      ]);
      const planning = board!.columns.find((c) => c.slug === "planning")!;
      expect(planning.count).toBe(1);
      expect(planning.total).toBe(8000); // read from `value`, not `amount`
      const live = board!.columns.find((c) => c.slug === "live")!;
      expect(live.total).toBe(2000);
      // The opportunity is absent from the campaign board.
      const allNames = board!.columns.flatMap((c) =>
        c.cards.map((card) => card.name)
      );
      expect(allNames).not.toContain("An opp");
    });
  });

  test("campaign board resolves the account name via campaign_belongs_to_account", async () => {
    await withTestTransaction(async (tx) => {
      const s = await setup(tx);
      const campId = await insertRecord(tx, s.tenantId, s.campaignType, {
        name: "Promo",
        stage: "brief",
      });
      const accId = await insertRecord(tx, s.tenantId, s.accountType, {
        name: "Advertiser Ltd",
      });
      await tx.insert(recordRelationships).values({
        tenantId: s.tenantId,
        relationshipId: s.campaignAcctRel,
        sourceRecordId: campId,
        targetRecordId: accId,
      });

      const board = await loadPipelineBoard(tx, {
        tenantId: s.tenantId,
        entity: "campaign",
      });
      const card = board!.columns
        .find((c) => c.slug === "brief")!
        .cards.find((c) => c.id === campId)!;
      expect(card.accountName).toBe("Advertiser Ltd");
    });
  });

  test("filters by owner, account, and close-date window", async () => {
    await withTestTransaction(async (tx) => {
      const s = await setup(tx);
      const accId = await insertRecord(tx, s.tenantId, s.accountType, {
        name: "Acme",
      });
      // Owned by our user, related to the account, closes 2026-06-15.
      const mine = await insertRecord(
        tx,
        s.tenantId,
        s.oppType,
        { name: "Mine", stage: "qualification", closeDate: "2026-06-15" },
        { ownedBy: s.userId }
      );
      await tx.insert(recordRelationships).values({
        tenantId: s.tenantId,
        relationshipId: s.acctRel,
        sourceRecordId: mine,
        targetRecordId: accId,
      });
      // Unowned, no account, closes 2026-12-31.
      await insertRecord(tx, s.tenantId, s.oppType, {
        name: "Other",
        stage: "qualification",
        closeDate: "2026-12-31",
      });

      const byOwner = await loadPipelineBoard(tx, {
        tenantId: s.tenantId,
        filters: { owner: s.userId },
      });
      expect(
        byOwner!.columns.find((c) => c.slug === "qualification")!.count
      ).toBe(1);

      const byAccount = await loadPipelineBoard(tx, {
        tenantId: s.tenantId,
        filters: { accountId: accId },
      });
      expect(
        byAccount!.columns.find((c) => c.slug === "qualification")!.count
      ).toBe(1);

      const byDate = await loadPipelineBoard(tx, {
        tenantId: s.tenantId,
        filters: { closeDateFrom: "2026-06-01", closeDateTo: "2026-06-30" },
      });
      const dateCards = byDate!.columns.find(
        (c) => c.slug === "qualification"
      )!.cards;
      expect(dateCards.map((c) => c.name)).toEqual(["Mine"]);
    });
  });
});
