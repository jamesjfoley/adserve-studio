import { and, eq, inArray } from "drizzle-orm";
import { entityTypes, withTenant } from "@adserve/database";
import type { PipelineEntity } from "./pipeline";
import {
  leadConversionFunnel,
  pipelineValueByStage,
  recentlyModifiedRecords,
  revenueForecast,
  upcomingActivities,
  type LeadFunnelStage,
  type PipelineStageValue,
  type RecentRecord,
  type RevenueForecast,
  type UpcomingActivity,
} from "./dashboard";

const CRM_ENTITY_SLUGS = [
  "account",
  "contact",
  "lead",
  "campaign",
  "opportunity",
] as const;

/** Value field per pipeline entity (mirrors pipeline.ts). */
const PIPELINE_VALUE_FIELD: Record<PipelineEntity, string> = {
  campaign: "value",
  opportunity: "amount",
};

const PIPELINE_LABEL: Record<PipelineEntity, string> = {
  campaign: "Campaign pipeline by stage",
  opportunity: "Opportunity pipeline by stage",
};

/** One aggregated pipeline section (a campaign board or an opportunity board). */
export interface PipelineSection {
  entity: PipelineEntity;
  label: string;
  /** Noun for KPI copy: "campaign" / "opportunity". */
  noun: string;
  stages: PipelineStageValue[];
}

export interface CrmDashboardData {
  /** One section per enabled pipeline entity, campaign-first. */
  pipelines: PipelineSection[];
  upcoming: UpcomingActivity[];
  recent: RecentRecord[];
  funnel: LeadFunnelStage[];
  /** Weighted forecast — opportunity-only (campaign has no probability). */
  forecast: RevenueForecast | null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Server-side data path for the CRM dashboard (/crm). Extracted from the page
 * so it is testable under enforced RLS (owns the page's withTenant call).
 *
 * Module-aware + campaign-first: aggregates a pipeline section for each enabled
 * pipeline entity (campaign when `campaigns`, opportunity when `opportunities`),
 * campaign first. The weighted revenue forecast stays opportunity-only.
 */
export async function loadCrmDashboardData(args: {
  tenantId: string;
  readableSlugs: string[];
  /** Which pipeline entities to aggregate, campaign-first. */
  pipelineEntities: PipelineEntity[];
  canLead: boolean;
  canActivities: boolean;
  /** Whether the opportunity forecast should be computed (opportunity-only). */
  canForecast: boolean;
}): Promise<CrmDashboardData> {
  const {
    tenantId,
    readableSlugs,
    pipelineEntities,
    canLead,
    canActivities,
    canForecast,
  } = args;

  const today = new Date();
  const weekOut = new Date(today);
  weekOut.setDate(weekOut.getDate() + 7);
  const plusDays = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return ymd(d);
  };

  return withTenant(tenantId, async (tx) => {
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
          inArray(entityTypes.slug, [...CRM_ENTITY_SLUGS])
        )
      );

    const bySlug = new Map(types.map((t) => [t.slug, t]));

    const readableIds = readableSlugs
      .map((s) => bySlug.get(s)?.id)
      .filter((id): id is string => Boolean(id));

    // Aggregate each enabled pipeline entity from ITS OWN stage set
    // (settings.pipelineStages) — campaign and opportunity never merge.
    const pipelines: PipelineSection[] = [];
    for (const entity of pipelineEntities) {
      const type = bySlug.get(entity);
      if (!type) continue;
      const stages = (
        (type.settings as { pipelineStages?: { slug: string; name: string }[] })
          ?.pipelineStages ?? []
      ).map((s) => ({ slug: s.slug, name: s.name }));
      const stageValues = await pipelineValueByStage(tx, {
        tenantId,
        entityTypeId: type.id,
        valueField: PIPELINE_VALUE_FIELD[entity],
        stages,
      });
      pipelines.push({
        entity,
        label: PIPELINE_LABEL[entity],
        noun: entity,
        stages: stageValues,
      });
    }

    let upcoming: UpcomingActivity[] = [];
    if (canActivities) {
      upcoming = await upcomingActivities(tx, {
        tenantId,
        from: ymd(today),
        to: ymd(weekOut),
        entityTypeIds: readableIds,
      });
    }

    const recent: RecentRecord[] = await recentlyModifiedRecords(tx, {
      tenantId,
      entityTypeIds: readableIds,
    });

    let funnel: LeadFunnelStage[] = [];
    const lead = bySlug.get("lead");
    if (canLead && lead) {
      funnel = await leadConversionFunnel(tx, {
        tenantId,
        leadEntityTypeId: lead.id,
      });
    }

    let forecast: RevenueForecast | null = null;
    const opportunity = bySlug.get("opportunity");
    if (canForecast && opportunity) {
      forecast = await revenueForecast(tx, {
        tenantId,
        opportunityEntityTypeId: opportunity.id,
        today: ymd(today),
        d30: plusDays(30),
        d60: plusDays(60),
        d90: plusDays(90),
      });
    }

    return { pipelines, upcoming, recent, funnel, forecast };
  });
}
