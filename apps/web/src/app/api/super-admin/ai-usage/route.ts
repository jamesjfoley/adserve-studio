import { NextResponse } from "next/server";
import {
  aiUsageLimits,
  aiUsageSummary,
  tenants,
  withSuperAdminBypass,
} from "@adserve/database";
import { currentPeriod } from "@adserve/ai-service";
import { and, eq, sql } from "drizzle-orm";
import { apiRequireSuperAdmin } from "@/lib/super-admin";

/**
 * GET /api/super-admin/ai-usage — platform-wide list of tenants by AI
 * spend for the current period. Super-admin only.
 */
export async function GET() {
  const auth = await apiRequireSuperAdmin();
  if (auth.error) return auth.error;

  const { start } = currentPeriod();

  const rows = await withSuperAdminBypass(async (tx) => {
    return tx
      .select({
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        totalCostMicros: aiUsageSummary.totalCostMicros,
        totalTokens: aiUsageSummary.totalTokens,
        requestCount: aiUsageSummary.requestCount,
        monthlyCostLimitMicros: aiUsageLimits.monthlyCostLimitMicros,
      })
      .from(tenants)
      .leftJoin(
        aiUsageSummary,
        and(
          eq(aiUsageSummary.tenantId, tenants.id),
          eq(aiUsageSummary.periodStart, start)
        )
      )
      .leftJoin(aiUsageLimits, eq(aiUsageLimits.tenantId, tenants.id))
      .orderBy(sql`${aiUsageSummary.totalCostMicros} desc nulls last`);
  });

  return NextResponse.json({ period: start, tenants: rows });
}
