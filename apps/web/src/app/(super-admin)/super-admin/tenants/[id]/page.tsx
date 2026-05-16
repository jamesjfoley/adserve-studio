import Link from "next/link";
import { notFound } from "next/navigation";
import {
  db,
  tenants,
  tenantMemberships,
  tenantModules,
  modules,
  users,
  roles,
} from "@adserve/database";
import { eq, desc } from "drizzle-orm";
import { TenantStatusActions } from "../_components/tenant-status-actions";
import { TenantModuleToggle } from "../_components/tenant-module-toggle";

const statusStyles: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  suspended: "bg-amber-100 text-amber-800",
  cancelled: "bg-red-100 text-red-800",
};

type Params = { params: Promise<{ id: string }> };

export default async function TenantDetailPage({ params }: Params) {
  const { id } = await params;

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
  if (!tenant) notFound();

  const [members, enabledRows, allModules] = await Promise.all([
    db
      .select({
        membershipId: tenantMemberships.id,
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        userStatus: users.status,
        membershipStatus: tenantMemberships.status,
        roleSlug: roles.slug,
        roleName: roles.name,
        joinedAt: tenantMemberships.joinedAt,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
      .where(eq(tenantMemberships.tenantId, id))
      .orderBy(desc(tenantMemberships.joinedAt)),
    db
      .select({
        moduleId: tenantModules.moduleId,
        enabled: tenantModules.enabled,
      })
      .from(tenantModules)
      .where(eq(tenantModules.tenantId, id)),
    db.select().from(modules),
  ]);

  const enabledMap = new Map(enabledRows.map((r) => [r.moduleId, r.enabled]));
  const moduleList = allModules
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((m) => ({ ...m, enabled: enabledMap.get(m.id) === true }));

  const settings = (tenant.settings ?? {}) as Record<string, unknown>;

  return (
    <div>
      <Link
        href="/super-admin/tenants"
        className="text-sm text-[var(--muted-foreground)] hover:underline"
      >
        ← All tenants
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {tenant.name}
            </h1>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                statusStyles[tenant.status] ?? "bg-gray-100 text-gray-800"
              }`}
            >
              {tenant.status}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">
            {tenant.slug}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TenantStatusActions
            tenantId={tenant.id}
            status={tenant.status}
          />
          <Link
            href={`/super-admin/tenants/${tenant.id}/edit`}
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--muted)]"
          >
            Edit settings
          </Link>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6">
          <h2 className="text-lg font-semibold">Settings</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="ID" value={tenant.id} mono />
            <Row label="Created" value={new Date(tenant.createdAt).toLocaleString("en-GB")} />
            <Row label="Updated" value={new Date(tenant.updatedAt).toLocaleString("en-GB")} />
            <Row
              label="Clerk org ID"
              value={(settings.clerkOrgId as string) || "—"}
              mono
            />
            <Row label="Timezone" value={(settings.timezone as string) || "—"} />
            <Row label="Locale" value={(settings.locale as string) || "—"} />
            <Row label="Currency" value={(settings.currency as string) || "—"} />
          </dl>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6">
          <h2 className="text-lg font-semibold">Modules</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Toggle module access for this tenant.
          </p>
          <ul className="mt-4 divide-y divide-[var(--border)]">
            {moduleList.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium">{m.name}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {m.slug} · {m.status} · v{m.version}
                  </p>
                </div>
                <TenantModuleToggle
                  tenantId={tenant.id}
                  moduleSlug={m.slug}
                  enabled={m.enabled}
                  disabled={m.status === "deprecated"}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--background)] p-6">
        <h2 className="text-lg font-semibold">
          Users ({members.length})
        </h2>
        <div className="mt-4 overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {members.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-[var(--muted-foreground)]"
                  >
                    No users yet.
                  </td>
                </tr>
              )}
              {members.map((m) => (
                <tr key={m.membershipId}>
                  <td className="px-4 py-2">{m.fullName}</td>
                  <td className="px-4 py-2 text-[var(--muted-foreground)]">
                    {m.email}
                  </td>
                  <td className="px-4 py-2">{m.roleName}</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs">
                      {m.membershipStatus}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[var(--muted-foreground)]">
                    {m.joinedAt
                      ? new Date(m.joinedAt).toLocaleDateString("en-GB")
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

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </dt>
      <dd
        className={`text-right text-sm ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
