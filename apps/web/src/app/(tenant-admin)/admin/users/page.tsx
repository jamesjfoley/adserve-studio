import { requireTenantAdmin } from "@/lib/tenant-admin";
import { loadAdminUsersData } from "@/lib/admin/loaders";
import { UsersListClient } from "./_components/users-list-client";

type SearchParams = Promise<{
  q?: string;
  role?: string;
  status?: string;
}>;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctx = await requireTenantAdmin();
  const { tenant, user: actor, role: actorRole } = ctx;
  const { q, role: roleFilter, status: statusFilter } = await searchParams;
  const query = q?.trim() ?? "";

  const [memberships, tenantRoles, pendingInvitations] = await loadAdminUsersData({
    tenantId: tenant.id,
    query,
    roleFilter,
    statusFilter,
  });

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
