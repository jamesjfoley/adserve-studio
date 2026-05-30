import { NextRequest, NextResponse } from "next/server";
import { aiUsageLog, tenants, withSuperAdminBypass } from "@adserve/database";
import { getCurrentPeriodSummary, getUsageLimits } from "@adserve/ai-service";
import { and, desc, eq, gte } from "drizzle-orm";
import { apiRequireSuperAdmin } from "@/lib/super-admin";

type Params = { params: Promise<{ tenantId: string }> };

/**
 * GET /api/super-admin/ai-usage/[tenantId] — drill-in for one tenant:
 * current-period summary, limits, and recent calls. Super-admin only.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await apiRequireSuperAdmin();
  if (auth.error) return auth.error;
  const { tenantId } = await params;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);

  const data = await withSuperAdminBypass(async (tx) => {
    const [tenant] = await tx
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant) return null;

    const summary = await getCurrentPeriodSummary({ tenantId }, tx);
    const limits = await getUsageLimits({ tenantId }, tx);
    const recent = await tx
      .select()
      .from(aiUsageLog)
      .where(
        and(eq(aiUsageLog.tenantId, tenantId), gte(aiUsageLog.createdAt, since))
      )
      .orderBy(desc(aiUsageLog.createdAt))
      .limit(50);

    return { tenant, summary, limits, recent };
  });

  if (!data) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
