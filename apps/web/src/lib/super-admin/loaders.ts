import {
  aiUsageLimits,
  aiUsageLog,
  aiUsageSummary,
  modules,
  tenantMemberships,
  tenantModules,
  tenants,
  users,
  withSuperAdminBypass,
} from "@adserve/database";
import { and, asc, count, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import {
  currentPeriod,
  getCurrentPeriodSummary,
  getUsageLimits,
} from "@adserve/ai-service";
import { loadTenantMembers, loadTenantModuleStates } from "@/lib/super-admin-queries";

/**
 * Server-side data paths for the /super-admin/** pages, extracted from the page
 * components so each is testable under enforced RLS (tidy-up 2). Each owns its
 * own withSuperAdminBypass() wrapper — the cross-tenant visibility a super admin
 * needs. Under the adserve_app harness this is load-bearing: if the bypass is
 * removed, the queries run with no tenant context and RLS scopes them to
 * nothing, so the cross-tenant assertions in the tests fail (rather than a
 * forgotten bypass silently passing).
 */

// ---- /super-admin (dashboard counts) ---------------------------------------
export async function loadSuperAdminDashboard() {
  const [activeTenantsRow, suspendedTenantsRow, totalUsersRow, activeUsersRow, recentTenants] =
    await withSuperAdminBypass((tx) =>
      Promise.all([
        tx.select({ n: count() }).from(tenants).where(eq(tenants.status, "active")),
        tx.select({ n: count() }).from(tenants).where(eq(tenants.status, "suspended")),
        tx.select({ n: count() }).from(users),
        tx.select({ n: count() }).from(users).where(eq(users.status, "active")),
        tx.select().from(tenants).orderBy(desc(tenants.createdAt)).limit(5),
      ])
    );
  return {
    activeTenants: activeTenantsRow[0]?.n ?? 0,
    suspendedTenants: suspendedTenantsRow[0]?.n ?? 0,
    totalUsers: totalUsersRow[0]?.n ?? 0,
    activeUsers: activeUsersRow[0]?.n ?? 0,
    recentTenants,
  };
}

// ---- /super-admin/tenants (list) -------------------------------------------
export async function loadSuperAdminTenantsList() {
  return withSuperAdminBypass((tx) =>
    tx
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        createdAt: tenants.createdAt,
        userCount: sql<number>`(SELECT COUNT(*)::int FROM tenant_memberships WHERE tenant_id = "tenants"."id")`,
        moduleCount: sql<number>`(SELECT COUNT(*)::int FROM tenant_modules WHERE tenant_id = "tenants"."id" AND enabled = true)`,
      })
      .from(tenants)
      .orderBy(desc(tenants.createdAt))
  );
}

// ---- /super-admin/tenants/[id] (detail) ------------------------------------
export async function loadSuperAdminTenantDetail(id: string) {
  return withSuperAdminBypass(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, id));
    if (!tenant) return null;
    const [members, moduleList] = await Promise.all([
      loadTenantMembers(tx, id),
      loadTenantModuleStates(tx, id),
    ]);
    return { tenant, members, moduleList };
  });
}

// ---- /super-admin/tenants/[id]/edit ----------------------------------------
export async function loadSuperAdminTenantForEdit(id: string) {
  const [tenant] = await withSuperAdminBypass((tx) =>
    tx.select().from(tenants).where(eq(tenants.id, id))
  );
  return tenant ?? null;
}

// ---- /super-admin/modules/[slug] -------------------------------------------
export async function loadSuperAdminModuleDetail(slug: string) {
  return withSuperAdminBypass(async (tx) => {
    const [moduleRow] = await tx.select().from(modules).where(eq(modules.slug, slug));
    if (!moduleRow) return null;
    const enabledTenants = await tx
      .select({
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        tenantStatus: tenants.status,
        enabledAt: tenantModules.enabledAt,
      })
      .from(tenantModules)
      .innerJoin(tenants, eq(tenants.id, tenantModules.tenantId))
      .where(and(eq(tenantModules.moduleId, moduleRow.id), eq(tenantModules.enabled, true)))
      .orderBy(asc(tenants.name));
    return { moduleRow, enabledTenants };
  });
}

// ---- /super-admin/users -----------------------------------------------------
export async function loadSuperAdminUsers(query = "") {
  const where =
    query.length > 0
      ? or(ilike(users.email, `%${query}%`), ilike(users.fullName, `%${query}%`))
      : undefined;
  return withSuperAdminBypass(async (tx) => {
    const userRows = await tx.select().from(users).where(where).orderBy(desc(users.createdAt));
    const userIds = userRows.map((u) => u.id);
    const memberships =
      userIds.length === 0
        ? []
        : await tx
            .select({
              userId: tenantMemberships.userId,
              tenantId: tenants.id,
              tenantName: tenants.name,
              tenantSlug: tenants.slug,
            })
            .from(tenantMemberships)
            .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
            .where(inArray(tenantMemberships.userId, userIds));
    return { userRows, memberships };
  });
}

// ---- /super-admin/ai-usage (cross-tenant list) -----------------------------
export async function loadSuperAdminAiUsageList() {
  const { start } = currentPeriod();
  return withSuperAdminBypass((tx) =>
    tx
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
        and(eq(aiUsageSummary.tenantId, tenants.id), eq(aiUsageSummary.periodStart, start))
      )
      .leftJoin(aiUsageLimits, eq(aiUsageLimits.tenantId, tenants.id))
      .orderBy(sql`${aiUsageSummary.totalCostMicros} desc nulls last`)
  );
}

// ---- /super-admin/ai-usage/[tenantId] --------------------------------------
export async function loadSuperAdminAiUsageDetail(tenantId: string) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  return withSuperAdminBypass(async (tx) => {
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
      .where(and(eq(aiUsageLog.tenantId, tenantId), gte(aiUsageLog.createdAt, since)))
      .orderBy(desc(aiUsageLog.createdAt))
      .limit(50);
    return { tenant, summary, limits, recent };
  });
}
