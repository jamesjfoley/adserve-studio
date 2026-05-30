import { NextResponse } from "next/server";
import { aiUsageLog, withTenant } from "@adserve/database";
import { getCurrentPeriodSummary, getUsageLimits } from "@adserve/ai-service";
import { and, desc, eq, gte } from "drizzle-orm";
import { apiRequirePermission } from "@/lib/permissions";

/**
 * GET /api/admin/ai-usage — the calling tenant's own AI usage.
 * Requires `ai_usage.read`. Returns the current-period summary, the
 * configured limits, and the most recent calls (last 30 days).
 */
export async function GET() {
  const guard = await apiRequirePermission("ai_usage.read");
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);

  const data = await withTenant(tenant.id, async (tx) => {
    const summary = await getCurrentPeriodSummary({ tenantId: tenant.id }, tx);
    const limits = await getUsageLimits({ tenantId: tenant.id }, tx);
    const recent = await tx
      .select()
      .from(aiUsageLog)
      .where(
        and(
          eq(aiUsageLog.tenantId, tenant.id),
          gte(aiUsageLog.createdAt, since)
        )
      )
      .orderBy(desc(aiUsageLog.createdAt))
      .limit(50);
    return { summary, limits, recent };
  });

  return NextResponse.json(data);
}
