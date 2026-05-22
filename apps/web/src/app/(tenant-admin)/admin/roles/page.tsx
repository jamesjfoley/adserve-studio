import Link from "next/link";
import { db, roles, tenantMemberships } from "@adserve/database";
import { asc, count, eq } from "drizzle-orm";
import { requireTenantAdmin } from "@/lib/tenant-admin";
import { RolesListActions } from "./_components/roles-list-actions";

export default async function AdminRolesPage() {
  const { tenant } = await requireTenantAdmin();

  const [tenantRoles, memberCountRows] = await Promise.all([
    db
      .select()
      .from(roles)
      .where(eq(roles.tenantId, tenant.id))
      .orderBy(asc(roles.name)),
    db
      .select({ roleId: tenantMemberships.roleId, n: count() })
      .from(tenantMemberships)
      .where(eq(tenantMemberships.tenantId, tenant.id))
      .groupBy(tenantMemberships.roleId),
  ]);

  const countByRole = new Map(memberCountRows.map((r) => [r.roleId, Number(r.n)]));

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
          <p className="mt-2 text-[var(--muted-foreground)]">
            {tenantRoles.length} role{tenantRoles.length === 1 ? "" : "s"} in{" "}
            {tenant.name}.
          </p>
        </div>
        <Link
          href="/admin/roles/new"
          className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Create role
        </Link>
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Users</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {tenantRoles.map((r) => {
              const memberCount = countByRole.get(r.id) ?? 0;
              return (
                <tr key={r.id} className="hover:bg-[var(--muted)]/50">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/admin/roles/${r.id}`} className="hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {r.description ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {memberCount}
                  </td>
                  <td className="px-4 py-3">
                    {r.isSystem ? (
                      <span className="inline-flex rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">
                        System
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--muted-foreground)]">
                        Custom
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RolesListActions
                      roleId={r.id}
                      roleName={r.name}
                      isSystem={r.isSystem}
                      memberCount={memberCount}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
