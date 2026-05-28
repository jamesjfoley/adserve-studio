import Link from "next/link";
import { tenants, withSuperAdminBypass } from "@adserve/database";
import { desc, sql } from "drizzle-orm";
import { TenantStatusActions } from "./_components/tenant-status-actions";

const statusStyles: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  suspended: "bg-amber-100 text-amber-800",
  cancelled: "bg-red-100 text-red-800",
};

export default async function TenantsListPage() {
  const rows = await withSuperAdminBypass((tx) =>
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

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tenants</h1>
          <p className="mt-2 text-[var(--muted-foreground)]">
            {rows.length} tenant{rows.length === 1 ? "" : "s"} across the
            platform.
          </p>
        </div>
        <Link
          href="/super-admin/tenants/new"
          className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Create tenant
        </Link>
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Slug</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Users</th>
              <th className="px-4 py-3 font-medium">Modules</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-[var(--muted-foreground)]"
                >
                  No tenants yet.
                </td>
              </tr>
            )}
            {rows.map((t) => (
              <tr key={t.id} className="hover:bg-[var(--muted)]/50">
                <td className="px-4 py-3 font-medium">
                  <Link
                    href={`/super-admin/tenants/${t.id}`}
                    className="hover:underline"
                  >
                    {t.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)] font-mono text-xs">
                  {t.slug}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      statusStyles[t.status] ?? "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="px-4 py-3">{t.userCount}</td>
                <td className="px-4 py-3">{t.moduleCount}</td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {new Date(t.createdAt).toLocaleDateString("en-GB")}
                </td>
                <td className="px-4 py-3">
                  <TenantStatusActions tenantId={t.id} status={t.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
