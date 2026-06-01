import { requireTenantAdmin } from "@/lib/tenant-admin";
import { loadAdminSettingsData } from "@/lib/admin/loaders";
import { ProfileForm } from "./_components/profile-form";

const statusStyles: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  suspended: "bg-amber-100 text-amber-800",
  cancelled: "bg-red-100 text-red-800",
};

export default async function AdminSettingsPage() {
  const { tenant, permissions } = await requireTenantAdmin();
  const canEdit = permissions.has("settings.admin");

  const enabledModules = await loadAdminSettingsData(tenant.id);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-2 text-[var(--muted-foreground)]">
        Tenant profile, modules, and subscription.
      </p>

      {/* Section 1: Profile */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Tenant profile</h2>
        {!canEdit && (
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            View only. Your role does not include the settings.admin permission.
          </p>
        )}
        <div className="mt-4 rounded-xl border border-[var(--border)] p-6">
          <ProfileForm
            canEdit={canEdit}
            initial={{
              name: tenant.name,
              contactEmail: tenant.contactEmail ?? "",
              phone: tenant.phone ?? "",
              address: tenant.address ?? "",
              logoUrl: tenant.logoUrl ?? "",
            }}
          />
        </div>
      </section>

      {/* Section 2: Modules */}
      <section className="mt-12">
        <h2 className="text-lg font-semibold tracking-tight">Modules</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Module access is managed by AdServe. Contact support to request changes.
        </p>
        <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
              <tr>
                <th className="px-4 py-3 font-medium">Module</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Enabled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {enabledModules.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-6 text-center text-[var(--muted-foreground)]"
                  >
                    No modules enabled.
                  </td>
                </tr>
              )}
              {enabledModules.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 font-medium">{m.name}</td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {m.description ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {m.enabledAt
                      ? new Date(m.enabledAt).toLocaleDateString("en-GB")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 3: Subscription */}
      <section className="mt-12">
        <h2 className="text-lg font-semibold tracking-tight">Subscription</h2>
        <div className="mt-4 rounded-xl border border-[var(--border)] p-6">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-[var(--muted-foreground)]">
                Status
              </dt>
              <dd className="mt-1">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[tenant.status] ?? "bg-gray-100 text-gray-800"}`}
                >
                  {tenant.status}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-[var(--muted-foreground)]">
                Created
              </dt>
              <dd className="mt-1 text-sm">
                {new Date(tenant.createdAt).toLocaleDateString("en-GB")}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-[var(--muted-foreground)]">
                Tenant ID
              </dt>
              <dd className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">
                {tenant.id}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-[var(--muted-foreground)]">
                Slug
              </dt>
              <dd className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">
                {tenant.slug}
              </dd>
            </div>
          </dl>

          {tenant.status === "suspended" && (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This tenant is suspended. Some functionality is unavailable.
              Contact AdServe to restore access.
            </p>
          )}
          {tenant.status === "cancelled" && (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              This tenant has been cancelled. Contact AdServe to discuss options.
            </p>
          )}

          <p className="mt-6 text-sm text-[var(--muted-foreground)]">
            Billing and subscription management coming soon.
          </p>
        </div>
      </section>
    </div>
  );
}
