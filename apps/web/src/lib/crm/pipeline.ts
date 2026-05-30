import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  entityTypes,
  recordRelationships,
  records,
  type db,
} from "@adserve/database";
import type { PipelineStageSpec } from "@adserve/crm";

/**
 * Read model for the Task 1.5 pipeline kanban. Pure-ish query function
 * taking an explicit `tenantId` so it's unit-testable and the page does
 * only context resolution + gating + presentation. Every query carries the
 * explicit `tenantId` predicate (dev superuser bypasses RLS) —
 * correct-by-construction, mirroring dashboard.ts.
 *
 * Account names are resolved by joining `record_relationships` (the
 * opportunity is always the *source*) to records of the ACCOUNT entity
 * type specifically — never "the other record on any relationship row",
 * which would conflate the primary-contact relationship with the account.
 */

export interface PipelineFilters {
  /** A user id, or "unassigned" for opportunities with no owner. */
  owner?: string | "unassigned";
  /** Restrict to opportunities related to this account record id. */
  accountId?: string;
  /** Inclusive close-date window, `YYYY-MM-DD`. */
  closeDateFrom?: string;
  closeDateTo?: string;
}

export interface PipelineCard {
  id: string;
  name: string;
  accountName: string | null;
  amount: number | null;
  currency: string;
  closeDate: string | null;
  probability: number | null;
  stage: string | null;
  ownedBy: string | null;
}

export interface PipelineColumn {
  slug: string;
  name: string;
  isClosed: boolean;
  count: number;
  /** Sum of card amounts (naive across currencies — Phase 1 has no FX). */
  total: number;
  cards: PipelineCard[];
}

export interface PipelineBoardData {
  columns: PipelineColumn[];
  /** Display currency for column totals. */
  currency: string;
}

const DEFAULT_CURRENCY = "GBP";
const OTHER_SLUG = "__other__";

function readAmount(data: Record<string, unknown>): {
  amount: number | null;
  currency: string;
} {
  const raw = data.amount as
    | { amount?: number | string; currency?: string }
    | undefined;
  if (!raw || raw.amount === undefined || raw.amount === null || raw.amount === "") {
    return { amount: null, currency: DEFAULT_CURRENCY };
  }
  const n = Number(raw.amount);
  return {
    amount: Number.isFinite(n) ? n : null,
    currency: raw.currency ?? DEFAULT_CURRENCY,
  };
}

/**
 * Build the kanban board for a tenant: one column per configured pipeline
 * stage (ordered by `displayOrder`), plus a trailing "Other" column for
 * opportunities whose stage matches no configured stage (slug `__other__`,
 * aligned with the dashboard convention). Archived opportunities excluded.
 */
export async function loadPipelineBoard(
  tx: typeof db,
  args: { tenantId: string; filters?: PipelineFilters }
): Promise<PipelineBoardData | null> {
  const { tenantId, filters = {} } = args;

  // Entity types we need (opportunity for the board, account for names).
  const types = await tx
    .select({
      id: entityTypes.id,
      slug: entityTypes.slug,
      settings: entityTypes.settings,
    })
    .from(entityTypes)
    .where(
      and(
        eq(entityTypes.tenantId, tenantId),
        inArray(entityTypes.slug, ["opportunity", "account"])
      )
    );
  const opp = types.find((t) => t.slug === "opportunity");
  const account = types.find((t) => t.slug === "account");
  if (!opp) return null;

  const stages =
    ((opp.settings as { pipelineStages?: PipelineStageSpec[] } | null)
      ?.pipelineStages ?? [])
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder);

  // ----- opportunity WHERE -----
  const conditions = [
    eq(records.tenantId, tenantId),
    eq(records.entityTypeId, opp.id),
    eq(records.isArchived, false),
  ];

  if (filters.owner === "unassigned") {
    conditions.push(isNull(records.ownedBy));
  } else if (filters.owner) {
    conditions.push(eq(records.ownedBy, filters.owner));
  }
  if (filters.closeDateFrom) {
    conditions.push(
      sql`(${records.data} ->> 'closeDate')::date >= ${filters.closeDateFrom}::date`
    );
  }
  if (filters.closeDateTo) {
    conditions.push(
      sql`(${records.data} ->> 'closeDate')::date <= ${filters.closeDateTo}::date`
    );
  }
  if (filters.accountId) {
    // Opportunities related to this account (opp is the source).
    const relatedOpps = await tx
      .select({ oppId: recordRelationships.sourceRecordId })
      .from(recordRelationships)
      .where(
        and(
          eq(recordRelationships.tenantId, tenantId),
          eq(recordRelationships.targetRecordId, filters.accountId)
        )
      );
    const oppIds = relatedOpps.map((r) => r.oppId);
    if (oppIds.length === 0) {
      return { columns: buildColumns(stages, []), currency: DEFAULT_CURRENCY };
    }
    conditions.push(inArray(records.id, oppIds));
  }

  const oppRows = await tx
    .select()
    .from(records)
    .where(and(...conditions));

  // ----- bulk account-name resolution (filter target to ACCOUNT type) -----
  const accountNameByOpp = new Map<string, string>();
  if (account && oppRows.length > 0) {
    const acc = alias(records, "acc");
    const relRows = await tx
      .select({
        oppId: recordRelationships.sourceRecordId,
        accountData: acc.data,
      })
      .from(recordRelationships)
      .innerJoin(
        acc,
        and(
          eq(acc.id, recordRelationships.targetRecordId),
          eq(acc.entityTypeId, account.id),
          eq(acc.tenantId, tenantId)
        )
      )
      .where(
        and(
          eq(recordRelationships.tenantId, tenantId),
          inArray(
            recordRelationships.sourceRecordId,
            oppRows.map((o) => o.id)
          )
        )
      );
    for (const r of relRows) {
      const name = (r.accountData as Record<string, unknown>)?.name;
      if (typeof name === "string" && !accountNameByOpp.has(r.oppId)) {
        accountNameByOpp.set(r.oppId, name);
      }
    }
  }

  const cards: PipelineCard[] = oppRows.map((row) => {
    const data = (row.data as Record<string, unknown>) ?? {};
    const { amount, currency } = readAmount(data);
    const probability =
      data.probability === undefined || data.probability === null
        ? null
        : Number(data.probability);
    return {
      id: row.id,
      name: typeof data.name === "string" ? data.name : row.id,
      accountName: accountNameByOpp.get(row.id) ?? null,
      amount,
      currency,
      closeDate: typeof data.closeDate === "string" ? data.closeDate : null,
      probability: Number.isFinite(probability) ? probability : null,
      stage: typeof data.stage === "string" ? data.stage : null,
      ownedBy: row.ownedBy ?? null,
    };
  });

  return { columns: buildColumns(stages, cards), currency: DEFAULT_CURRENCY };
}

function buildColumns(
  stages: PipelineStageSpec[],
  cards: PipelineCard[]
): PipelineColumn[] {
  const byStage = new Map<string, PipelineCard[]>();
  for (const card of cards) {
    const key = card.stage ?? "";
    (byStage.get(key) ?? byStage.set(key, []).get(key)!).push(card);
  }

  const known = new Set(stages.map((s) => s.slug));
  const columns: PipelineColumn[] = stages.map((s) => {
    const stageCards = byStage.get(s.slug) ?? [];
    return {
      slug: s.slug,
      name: s.name,
      isClosed: s.isClosed,
      count: stageCards.length,
      total: stageCards.reduce((sum, c) => sum + (c.amount ?? 0), 0),
      cards: stageCards,
    };
  });

  // Trailing "Other" column for opportunities whose stage isn't configured.
  const otherCards: PipelineCard[] = [];
  for (const [key, list] of byStage) {
    if (!known.has(key)) otherCards.push(...list);
  }
  if (otherCards.length > 0) {
    columns.push({
      slug: OTHER_SLUG,
      name: "Other",
      isClosed: false,
      count: otherCards.length,
      total: otherCards.reduce((sum, c) => sum + (c.amount ?? 0), 0),
      cards: otherCards,
    });
  }

  return columns;
}
