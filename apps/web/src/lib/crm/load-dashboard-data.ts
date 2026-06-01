import { and, eq, inArray } from "drizzle-orm";
import { entityTypes, withTenant } from "@adserve/database";
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

const CRM_ENTITY_SLUGS = ["account", "contact", "lead", "opportunity"] as const;

export interface CrmDashboardData {
  pipeline: PipelineStageValue[];
  upcoming: UpcomingActivity[];
  recent: RecentRecord[];
  funnel: LeadFunnelStage[];
  forecast: RevenueForecast | null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Server-side data path for the CRM dashboard (/crm). Extracted from the page
 * so it is testable under enforced RLS (owns the page's withTenant call).
 * Permission flags are resolved by the caller (page) and passed in.
 */
export async function loadCrmDashboardData(args: {
  tenantId: string;
  readableSlugs: string[];
  canPipeline: boolean;
  canLead: boolean;
  canActivities: boolean;
}): Promise<CrmDashboardData> {
  const { tenantId, readableSlugs, canPipeline, canLead, canActivities } = args;

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
    const opportunity = bySlug.get("opportunity");

    const readableIds = readableSlugs
      .map((s) => bySlug.get(s)?.id)
      .filter((id): id is string => Boolean(id));

    let pipeline: PipelineStageValue[] = [];
    if (canPipeline && opportunity) {
      const stages = (
        (opportunity.settings as {
          pipelineStages?: { slug: string; name: string }[];
        })?.pipelineStages ?? []
      ).map((s) => ({ slug: s.slug, name: s.name }));
      pipeline = await pipelineValueByStage(tx, {
        tenantId,
        opportunityEntityTypeId: opportunity.id,
        stages,
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
    if (canPipeline && opportunity) {
      forecast = await revenueForecast(tx, {
        tenantId,
        opportunityEntityTypeId: opportunity.id,
        today: ymd(today),
        d30: plusDays(30),
        d60: plusDays(60),
        d90: plusDays(90),
      });
    }

    return { pipeline, upcoming, recent, funnel, forecast };
  });
}
