import { requireTenantAdmin } from "@/lib/tenant-admin";
import { loadAdminDashboardData } from "@/lib/admin/loaders";

export default async function TenantAdminDashboardPage() {
  const { tenant } = await requireTenantAdmin();

  const counts = await loadAdminDashboardData(tenant.id);

  const cards = [
    {
      label: "Total users",
      value: counts.total,
      description: "All memberships in this tenant",
    },
    {
      label: "Active users",
      value: counts.active,
      description: "Membership status = active",
    },
    {
      label: "Pending invitations",
      value: counts.invited,
      description: "Membership status = invited",
    },
    {
      label: "Enabled modules",
      value: counts.modules,
      description: "Modules enabled by AdServe",
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        {tenant.name}
      </h1>
      <p className="mt-2 text-[var(--muted-foreground)]">
        Tenant administration overview.
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
    </div>
  );
}
