import { requirePermission } from "@/lib/permissions";
import { Panel } from "@/components/ui/panel";
import { readCrmModuleConfig } from "@/lib/crm/module-config";
import { ModulesForm } from "./_components/modules-form";

export const dynamic = "force-dynamic";

/**
 * CRM modules settings. Gated on crm.admin (matching the /api/admin/crm/modules
 * write authz and the CRM fields page). Lets an admin show/hide Leads,
 * Campaigns and Opportunities and pick the Lead-convert target. Accounts +
 * Contacts are always on and rendered non-interactively.
 */
export default async function CrmModulesPage() {
  const ctx = await requirePermission("crm.admin");
  const config = readCrmModuleConfig(ctx.tenant.settings);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">CRM modules</h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Choose which CRM modules appear for this organisation. Disabling a
        module hides it everywhere without deleting any data.
      </p>

      <div className="mt-6 grid gap-6">
        <Panel title="Always on">
          <ul className="divide-y divide-[var(--border)]">
            {[
              {
                label: "Accounts",
                note: "Companies you work with. Notes & Activities included.",
              },
              {
                label: "Contacts",
                note: "People at those accounts. Notes & Activities included.",
              },
            ].map((row) => (
              <li
                key={row.label}
                className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    {row.label}
                  </p>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {row.note}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <input
                    type="checkbox"
                    checked
                    disabled
                    readOnly
                    aria-label={`${row.label} (always on)`}
                  />
                  Always on
                </label>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Optional modules">
          <ModulesForm
            initial={{
              leads: config.leads,
              campaigns: config.campaigns,
              opportunities: config.opportunities,
              convertTarget: config.convertTarget,
            }}
            canEdit={ctx.permissions.has("crm.admin")}
          />
        </Panel>

        <p className="text-sm text-[var(--muted-foreground)]">
          Pipeline and the CRM dashboard appear when Campaigns or Opportunities
          is on. Disabling a module hides it without deleting its data.
        </p>
      </div>
    </div>
  );
}
