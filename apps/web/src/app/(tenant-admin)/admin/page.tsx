import {
  tenantMemberships,
  tenantModules,
  withTenant,
} from "@adserve/database";
import { and, count, eq } from "drizzle-orm";
import { requireTenantAdmin } from "@/lib/tenant-admin";

export default async function TenantAdminDashboardPage() {
  const { tenant } = await requireTenantAdmin();

  const [totalRow, activeRow, invitedRow, modulesRow] = await withTenant(
    tenant.id,
    (tx) =>
      Promise.all([
        tx
          .select({ n: count() })
          .from(tenantMemberships)
          .where(eq(tenantMemberships.tenantId, tenant.id)),
        tx
          .select({ n: count() })
          .from(tenantMemberships)
          .where(
            and(
              eq(tenantMemberships.tenantId, tenant.id),
              eq(tenantMemberships.status, "active")
            )
          ),
        tx
          .select({ n: count() })
          .from(tenantMemberships)
          .where(
            and(
              eq(tenantMemberships.tenantId, tenant.id),
              eq(tenantMemberships.status, "invited")
            )
          ),
        tx
          .select({ n: count() })
          .from(tenantModules)
          .where(
            and(
              eq(tenantModules.tenantId, tenant.id),
              eq(tenantModules.enabled, true)
            )
          ),
      ])
  );

  const cards = [
    {
      label: "Total users",
      value: totalRow[0]?.n ?? 0,
      description: "All memberships in this tenant",
    },
    {
      label: "Active users",
      value: activeRow[0]?.n ?? 0,
      description: "Membership status = active",
    },
    {
      label: "Pending invitations",
      value: invitedRow[0]?.n ?? 0,
      description: "Membership status = invited",
    },
    {
      label: "Enabled modules",
      value: modulesRow[0]?.n ?? 0,
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
