import Link from "next/link";
import { notFound } from "next/navigation";
import { db, modules, tenantModules, tenants } from "@adserve/database";
import { and, asc, eq } from "drizzle-orm";

const statusStyles: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  coming_soon: "bg-amber-100 text-amber-800",
  deprecated: "bg-gray-200 text-gray-700",
};

const tenantStatusStyles: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  suspended: "bg-amber-100 text-amber-800",
  cancelled: "bg-red-100 text-red-800",
};

type Params = { params: Promise<{ slug: string }> };

export default async function ModuleDetailPage({ params }: Params) {
  const { slug } = await params;

  const [moduleRow] = await db
    .select()
    .from(modules)
    .where(eq(modules.slug, slug));
  if (!moduleRow) notFound();

  const enabledTenants = await db
    .select({
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      tenantStatus: tenants.status,
      enabledAt: tenantModules.enabledAt,
    })
    .from(tenantModules)
    .innerJoin(tenants, eq(tenants.id, tenantModules.tenantId))
    .where(
      and(
        eq(tenantModules.moduleId, moduleRow.id),
        eq(tenantModules.enabled, true)
      )
    )
    .orderBy(asc(tenants.name));

  return (
    <div>
      <Link
        href="/super-admin/modules"
        className="text-sm text-[var(--muted-foreground)] hover:underline"
      >
        ← All modules
      </Link>

      <div className="mt-4 flex items-start gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {moduleRow.name}
        </h1>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
            statusStyles[moduleRow.status] ?? "bg-gray-100 text-gray-800"
          }`}
        >
          {moduleRow.status}
        </span>
      </div>
      <p className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">
        {moduleRow.slug} · v{moduleRow.version}
      </p>
      {moduleRow.description && (
        <p className="mt-3 max-w-2xl text-sm text-[var(--muted-foreground)]">
          {moduleRow.description}
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          Tenants with this module enabled ({enabledTenants.length})
        </h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
              <tr>
                <th className="px-4 py-3 font-medium">Tenant</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Enabled at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {enabledTenants.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-[var(--muted-foreground)]"
                  >
                    No tenants have this module enabled.
                  </td>
                </tr>
              )}
              {enabledTenants.map((t) => (
                <tr key={t.tenantId} className="hover:bg-[var(--muted)]/50">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/super-admin/tenants/${t.tenantId}`}
                      className="hover:underline"
                    >
                      {t.tenantName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)] font-mono text-xs">
                    {t.tenantSlug}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        tenantStatusStyles[t.tenantStatus] ??
                        "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {t.tenantStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {t.enabledAt
                      ? new Date(t.enabledAt).toLocaleDateString("en-GB")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
