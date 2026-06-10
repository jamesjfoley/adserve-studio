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

/**
 * Which pipeline entity a board is built for. Campaign and opportunity each
 * have their OWN stage set (never merged) and their own value field slug
 * (`value` vs `amount`) — see PIPELINE_ENTITY_CONFIG below.
 */
export type PipelineEntity = "campaign" | "opportunity";

interface PipelineEntityConfig {
  slug: PipelineEntity;
  /** Currency field slug on records.data ({ amount, currency } shape). */
  valueField: string;
  /** Optional date field surfaced on the card (display only). */
  dateField: string;
}

const PIPELINE_ENTITY_CONFIG: Record<PipelineEntity, PipelineEntityConfig> = {
  campaign: { slug: "campaign", valueField: "value", dateField: "flightEnd" },
  opportunity: { slug: "opportunity", valueField: "amount", dateField: "closeDate" },
};

const DEFAULT_CURRENCY = "GBP";
const OTHER_SLUG = "__other__";

function readAmount(
  data: Record<string, unknown>,
  field: string
): {
  amount: number | null;
  currency: string;
} {
  const raw = data[field] as
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
  args: { tenantId: string; entity?: PipelineEntity; filters?: PipelineFilters }
): Promise<PipelineBoardData | null> {
  const { tenantId, entity = "opportunity", filters = {} } = args;
  const cfg = PIPELINE_ENTITY_CONFIG[entity];

  // Entity types we need (the pipeline entity for the board, account for names).
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
        inArray(entityTypes.slug, [cfg.slug, "account"])
      )
    );
  const dealType = types.find((t) => t.slug === cfg.slug);
  const account = types.find((t) => t.slug === "account");
  if (!dealType) return null;

  // Stage set comes from THIS entity's settings.pipelineStages — campaign
  // (CAMPAIGN_STAGES) and opportunity (DEFAULT_PIPELINE_STAGES) are stamped
  // separately at activation, so the two boards never share a column set.
  const stages =
    ((dealType.settings as { pipelineStages?: PipelineStageSpec[] } | null)
      ?.pipelineStages ?? [])
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder);

  // ----- deal WHERE -----
  const conditions = [
    eq(records.tenantId, tenantId),
    eq(records.entityTypeId, dealType.id),
    eq(records.isArchived, false),
  ];

  if (filters.owner === "unassigned") {
    conditions.push(isNull(records.ownedBy));
  } else if (filters.owner) {
    conditions.push(eq(records.ownedBy, filters.owner));
  }
  if (filters.closeDateFrom) {
    conditions.push(
      sql`(${records.data} ->> ${cfg.dateField})::date >= ${filters.closeDateFrom}::date`
    );
  }
  if (filters.closeDateTo) {
    conditions.push(
      sql`(${records.data} ->> ${cfg.dateField})::date <= ${filters.closeDateTo}::date`
    );
  }
  if (filters.accountId) {
    // Deals related to this account (the deal is the source).
    const relatedDeals = await tx
      .select({ dealId: recordRelationships.sourceRecordId })
      .from(recordRelationships)
      .where(
        and(
          eq(recordRelationships.tenantId, tenantId),
          eq(recordRelationships.targetRecordId, filters.accountId)
        )
      );
    const dealIds = relatedDeals.map((r) => r.dealId);
    if (dealIds.length === 0) {
      return { columns: buildColumns(stages, []), currency: DEFAULT_CURRENCY };
    }
    conditions.push(inArray(records.id, dealIds));
  }

  const dealRows = await tx
    .select()
    .from(records)
    .where(and(...conditions));

  // ----- bulk account-name resolution (filter target to ACCOUNT type) -----
  const accountNameByDeal = new Map<string, string>();
  if (account && dealRows.length > 0) {
    const acc = alias(records, "acc");
    const relRows = await tx
      .select({
        dealId: recordRelationships.sourceRecordId,
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
            dealRows.map((o) => o.id)
          )
        )
      );
    for (const r of relRows) {
      const name = (r.accountData as Record<string, unknown>)?.name;
      if (typeof name === "string" && !accountNameByDeal.has(r.dealId)) {
        accountNameByDeal.set(r.dealId, name);
      }
    }
  }

  const cards: PipelineCard[] = dealRows.map((row) => {
    const data = (row.data as Record<string, unknown>) ?? {};
    const { amount, currency } = readAmount(data, cfg.valueField);
    const probability =
      data.probability === undefined || data.probability === null
        ? null
        : Number(data.probability);
    const date = data[cfg.dateField];
    return {
      id: row.id,
      name: typeof data.name === "string" ? data.name : row.id,
      accountName: accountNameByDeal.get(row.id) ?? null,
      amount,
      currency,
      closeDate: typeof date === "string" ? date : null,
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
