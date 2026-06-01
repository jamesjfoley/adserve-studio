import {
  aiUsageLog,
  entityTypes,
  modules,
  rolePermissions,
  roles,
  tenantInvitations,
  tenantMemberships,
  tenantModules,
  users,
  withTenant,
} from "@adserve/database";
import { and, asc, count, desc, eq, gte, ilike, or } from "drizzle-orm";
import {
  createLayout,
  generateDefaultLayoutConfig,
  getDefaultLayout,
  listFieldDefinitions,
  type LayoutConfig,
} from "@adserve/module-framework";
import { getCurrentPeriodSummary, getUsageLimits } from "@adserve/ai-service";
import { getVisiblePermissions } from "@/app/(tenant-admin)/admin/roles/_lib/visible-permissions";

/**
 * Server-side data paths for the /admin/** pages, extracted from the page
 * components so each is testable under enforced RLS (hardening step 2 residual).
 * Each function owns the page's own withTenant() wrapper — so a test exercising
 * it proves the page establishes tenant context (a forgotten wrapper → RLS
 * returns empty → the test's positive assertion fails).
 */

// ---- /admin (counts) --------------------------------------------------------
export async function loadAdminDashboardData(tenantId: string) {
  const [totalRow, activeRow, invitedRow, modulesRow] = await withTenant(
    tenantId,
    (tx) =>
      Promise.all([
        tx.select({ n: count() }).from(tenantMemberships).where(eq(tenantMemberships.tenantId, tenantId)),
        tx
          .select({ n: count() })
          .from(tenantMemberships)
          .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, "active"))),
        tx
          .select({ n: count() })
          .from(tenantMemberships)
          .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, "invited"))),
        tx
          .select({ n: count() })
          .from(tenantModules)
          .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.enabled, true))),
      ])
  );
  return {
    total: totalRow[0]?.n ?? 0,
    active: activeRow[0]?.n ?? 0,
    invited: invitedRow[0]?.n ?? 0,
    modules: modulesRow[0]?.n ?? 0,
  };
}

// ---- /admin/roles -----------------------------------------------------------
export async function loadAdminRolesData(tenantId: string) {
  const [tenantRoles, memberCountRows] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.select().from(roles).where(eq(roles.tenantId, tenantId)).orderBy(asc(roles.name)),
      tx
        .select({ roleId: tenantMemberships.roleId, n: count() })
        .from(tenantMemberships)
        .where(eq(tenantMemberships.tenantId, tenantId))
        .groupBy(tenantMemberships.roleId),
    ])
  );
  return { tenantRoles, memberCountRows };
}

// ---- /admin/users -----------------------------------------------------------
export async function loadAdminUsersData(args: {
  tenantId: string;
  query?: string;
  roleFilter?: string;
  statusFilter?: (typeof ALLOWED_USER_STATUSES)[number] | string;
}) {
  const { tenantId, query = "", roleFilter, statusFilter } = args;
  const conditions = [
    eq(tenantMemberships.tenantId, tenantId),
    eq(users.isSuperAdmin, false),
  ];
  if (query.length > 0) {
    conditions.push(
      or(ilike(users.email, `%${query}%`), ilike(users.fullName, `%${query}%`))!
    );
  }
  if (roleFilter) conditions.push(eq(roles.slug, roleFilter));
  if (statusFilter && (ALLOWED_USER_STATUSES as readonly string[]).includes(statusFilter)) {
    conditions.push(
      eq(tenantMemberships.status, statusFilter as (typeof ALLOWED_USER_STATUSES)[number])
    );
  }

  return withTenant(tenantId, (tx) =>
    Promise.all([
      tx
        .select({
          membershipId: tenantMemberships.id,
          userId: users.id,
          fullName: users.fullName,
          email: users.email,
          status: tenantMemberships.status,
          joinedAt: tenantMemberships.joinedAt,
          roleId: roles.id,
          roleSlug: roles.slug,
          roleName: roles.name,
        })
        .from(tenantMemberships)
        .innerJoin(users, eq(users.id, tenantMemberships.userId))
        .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
        .where(and(...conditions))
        .orderBy(desc(tenantMemberships.joinedAt)),
      tx.select().from(roles).where(eq(roles.tenantId, tenantId)).orderBy(asc(roles.name)),
      tx
        .select({
          id: tenantInvitations.id,
          email: tenantInvitations.email,
          createdAt: tenantInvitations.createdAt,
          roleName: roles.name,
          roleSlug: roles.slug,
          invitedByName: users.fullName,
        })
        .from(tenantInvitations)
        .innerJoin(roles, eq(roles.id, tenantInvitations.roleId))
        .leftJoin(users, eq(users.id, tenantInvitations.invitedBy))
        .where(and(eq(tenantInvitations.tenantId, tenantId), eq(tenantInvitations.status, "pending")))
        .orderBy(desc(tenantInvitations.createdAt)),
    ])
  );
}
export const ALLOWED_USER_STATUSES = ["active", "invited", "suspended"] as const;

// ---- /admin/settings --------------------------------------------------------
export async function loadAdminSettingsData(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: modules.id,
        slug: modules.slug,
        name: modules.name,
        description: modules.description,
        enabledAt: tenantModules.enabledAt,
      })
      .from(tenantModules)
      .innerJoin(modules, eq(modules.id, tenantModules.moduleId))
      .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.enabled, true)))
      .orderBy(asc(modules.name))
  );
}

// ---- /admin/ai-usage --------------------------------------------------------
export async function loadAdminAiUsageData(tenantId: string) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  return withTenant(tenantId, async (tx) => {
    const summary = await getCurrentPeriodSummary({ tenantId }, tx);
    const limits = await getUsageLimits({ tenantId }, tx);
    const recent = await tx
      .select()
      .from(aiUsageLog)
      .where(and(eq(aiUsageLog.tenantId, tenantId), gte(aiUsageLog.createdAt, since)))
      .orderBy(desc(aiUsageLog.createdAt))
      .limit(50);
    return { summary, limits, recent };
  });
}

// ---- /admin/crm/fields ------------------------------------------------------
export async function loadAdminFieldsData(args: { tenantId: string; entitySlug: string }) {
  const { tenantId, entitySlug } = args;
  return withTenant(tenantId, async (tx) => {
    const [entity] = await tx
      .select({ id: entityTypes.id })
      .from(entityTypes)
      .where(and(eq(entityTypes.tenantId, tenantId), eq(entityTypes.slug, entitySlug)));
    if (!entity) return [];
    return listFieldDefinitions(tx, { tenantId, entityTypeId: entity.id });
  });
}

// ---- /admin/crm/layouts -----------------------------------------------------
export async function loadAdminLayoutsData(args: { tenantId: string; entitySlug: string }) {
  const { tenantId, entitySlug } = args;
  return withTenant(tenantId, async (tx) => {
    const [entity] = await tx
      .select({ id: entityTypes.id })
      .from(entityTypes)
      .where(and(eq(entityTypes.tenantId, tenantId), eq(entityTypes.slug, entitySlug)));
    if (!entity) return null;

    const fields = await listFieldDefinitions(tx, { tenantId, entityTypeId: entity.id });

    let layout = await getDefaultLayout(tx, {
      tenantId,
      entityTypeId: entity.id,
      layoutType: "detail",
    });
    if (!layout) {
      const config = await generateDefaultLayoutConfig(tx, { tenantId, entityTypeId: entity.id });
      layout = await createLayout(tx, {
        tenantId,
        entityTypeId: entity.id,
        layoutType: "detail",
        name: "Detail",
        isDefault: true,
        config,
      });
    }

    return {
      layoutId: layout.id,
      config: layout.config as LayoutConfig,
      fields: fields.map((f) => ({ id: f.id, name: f.name })),
    };
  });
}

// ---- /admin/crm/pipeline (config) ------------------------------------------
export async function loadAdminPipelineConfigData(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [opp] = await tx
      .select({ settings: entityTypes.settings })
      .from(entityTypes)
      .where(and(eq(entityTypes.tenantId, tenantId), eq(entityTypes.slug, "opportunity")));
    return (
      (opp?.settings as { pipelineStages?: PipelineStageLike[] } | null)?.pipelineStages ?? []
    )
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder);
  });
}
interface PipelineStageLike {
  slug: string;
  name: string;
  defaultProbability: number;
  isClosed: boolean;
  isWon: boolean;
  displayOrder: number;
}

// ---- /admin/roles/new -------------------------------------------------------
export async function loadAdminNewRoleData(tenantId: string) {
  return withTenant(tenantId, (tx) => getVisiblePermissions(tx, tenantId));
}

// ---- /admin/roles/[id] ------------------------------------------------------
export async function loadAdminRoleEditData(args: { tenantId: string; roleId: string }) {
  const { tenantId, roleId } = args;
  return withTenant(tenantId, async (tx) => {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));
    if (!role) return null;

    const [allPermissions, currentPermRows] = await Promise.all([
      getVisiblePermissions(tx, tenantId),
      tx
        .select({ permissionId: rolePermissions.permissionId })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, role.id)),
    ]);
    return { role, allPermissions, currentPermRows };
  });
}
