import Link from "next/link";
import { db, modules } from "@adserve/database";
import { asc, sql } from "drizzle-orm";

const statusStyles: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  coming_soon: "bg-amber-100 text-amber-800",
  deprecated: "bg-gray-200 text-gray-700",
};

export default async function ModulesListPage() {
  const rows = await db
    .select({
      id: modules.id,
      slug: modules.slug,
      name: modules.name,
      status: modules.status,
      version: modules.version,
      displayOrder: modules.displayOrder,
      tenantCount: sql<number>`(SELECT COUNT(*)::int FROM tenant_modules WHERE module_id = "modules"."id" AND enabled = true)`,
    })
    .from(modules)
    .orderBy(asc(modules.displayOrder));

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Modules</h1>
      <p className="mt-2 text-[var(--muted-foreground)]">
        Platform module registry. Tenant-level enablement is managed from each
        tenant&apos;s detail page.
      </p>

      <div className="mt-8 overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Slug</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Version</th>
              <th className="px-4 py-3 font-medium">Tenants enabled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((m) => (
              <tr key={m.id} className="hover:bg-[var(--muted)]/50">
                <td className="px-4 py-3 font-medium">
                  <Link
                    href={`/super-admin/modules/${m.slug}`}
                    className="hover:underline"
                  >
                    {m.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)] font-mono text-xs">
                  {m.slug}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      statusStyles[m.status] ?? "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {m.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  v{m.version}
                </td>
                <td className="px-4 py-3">{m.tenantCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
