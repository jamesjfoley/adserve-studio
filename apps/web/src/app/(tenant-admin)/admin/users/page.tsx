import {
  db,
  tenantMemberships,
  tenantInvitations,
  users,
  roles,
} from "@adserve/database";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { requireTenantAdmin } from "@/lib/tenant-admin";
import { UsersListClient } from "./_components/users-list-client";

type SearchParams = Promise<{
  q?: string;
  role?: string;
  status?: string;
}>;

const ALLOWED_STATUSES = ["active", "invited", "suspended"] as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctx = await requireTenantAdmin();
  const { tenant, user: actor, role: actorRole } = ctx;
  const { q, role: roleFilter, status: statusFilter } = await searchParams;
  const query = q?.trim() ?? "";

  const conditions = [
    eq(tenantMemberships.tenantId, tenant.id),
    eq(users.isSuperAdmin, false),
  ];
  if (query.length > 0) {
    conditions.push(
      or(
        ilike(users.email, `%${query}%`),
        ilike(users.fullName, `%${query}%`)
      )!
    );
  }
  if (roleFilter) {
    conditions.push(eq(roles.slug, roleFilter));
  }
  if (
    statusFilter &&
    (ALLOWED_STATUSES as readonly string[]).includes(statusFilter)
  ) {
    conditions.push(
      eq(
        tenantMemberships.status,
        statusFilter as (typeof ALLOWED_STATUSES)[number]
      )
    );
  }

  const [memberships, tenantRoles, pendingInvitations] = await Promise.all([
    db
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

    db
      .select()
      .from(roles)
      .where(eq(roles.tenantId, tenant.id))
      .orderBy(asc(roles.name)),

    db
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
      .where(
        and(
          eq(tenantInvitations.tenantId, tenant.id),
          eq(tenantInvitations.status, "pending")
        )
      )
      .orderBy(desc(tenantInvitations.createdAt)),
  ]);

  const memberCount = memberships.length;

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-2 text-[var(--muted-foreground)]">
            {memberCount} user{memberCount === 1 ? "" : "s"} in {tenant.name}.
          </p>
        </div>
      </div>

      <UsersListClient
        actorUserId={actor.id}
        actorIsOwner={actorRole.slug === "owner"}
        initialQuery={query}
        initialRoleFilter={roleFilter ?? ""}
        initialStatusFilter={statusFilter ?? ""}
        memberships={memberships.map((m) => ({
          ...m,
          joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
        }))}
        roles={tenantRoles.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
        }))}
        invitations={pendingInvitations.map((i) => ({
          ...i,
          createdAt: i.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
