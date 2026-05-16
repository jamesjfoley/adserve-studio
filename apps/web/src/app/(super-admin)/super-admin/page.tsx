import Link from "next/link";
import { db, tenants, users } from "@adserve/database";
import { count, desc, eq } from "drizzle-orm";

const statusStyles: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  suspended: "bg-amber-100 text-amber-800",
  cancelled: "bg-red-100 text-red-800",
};

export default async function SuperAdminDashboardPage() {
  const [
    activeTenantsRow,
    suspendedTenantsRow,
    totalUsersRow,
    activeUsersRow,
    recentTenants,
  ] = await Promise.all([
    db.select({ n: count() }).from(tenants).where(eq(tenants.status, "active")),
    db
      .select({ n: count() })
      .from(tenants)
      .where(eq(tenants.status, "suspended")),
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(users).where(eq(users.status, "active")),
    db.select().from(tenants).orderBy(desc(tenants.createdAt)).limit(5),
  ]);

  const cards = [
    {
      label: "Active tenants",
      value: activeTenantsRow[0]?.n ?? 0,
      description: "Status = active",
    },
    {
      label: "Suspended tenants",
      value: suspendedTenantsRow[0]?.n ?? 0,
      description: "Status = suspended",
    },
    {
      label: "Total users",
      value: totalUsersRow[0]?.n ?? 0,
      description: "All users",
    },
    {
      label: "Active users",
      value: activeUsersRow[0]?.n ?? 0,
      description: "Status = active",
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Super admin</h1>
      <p className="mt-2 text-[var(--muted-foreground)]">
        Platform-wide view across all tenants.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6"
          >
            <p className="text-sm font-medium text-[var(--muted-foreground)]">
              {card.label}
            </p>
            <p className="mt-2 text-3xl font-semibold">{card.value}</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {card.description}
            </p>
          </div>
        ))}
      </div>

      <section className="mt-12">
        <h2 className="text-lg font-semibold tracking-tight">Recent tenants</h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {recentTenants.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-[var(--muted-foreground)]"
                  >
                    No tenants yet.
                  </td>
                </tr>
              )}
              {recentTenants.map((tenant) => (
                <tr key={tenant.id} className="hover:bg-[var(--muted)]/50">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/super-admin/tenants/${tenant.id}`}
                      className="hover:underline"
                    >
                      {tenant.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)] font-mono text-xs">
                    {tenant.slug}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        statusStyles[tenant.status] ?? "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {tenant.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {new Date(tenant.createdAt).toLocaleDateString("en-GB")}
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
