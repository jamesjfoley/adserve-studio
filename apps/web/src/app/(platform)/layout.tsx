import { UserButton, OrganizationSwitcher } from "@clerk/nextjs";
import { getSuperAdminOrNull } from "@/lib/super-admin";
import { getTenantContextOrNull } from "@/lib/permissions";
import { PrimaryNav, type NavItem } from "@/components/nav/primary-nav";
import { readTenantPalette } from "@/lib/theme/palettes";

const navigation: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", iconName: "dashboard" },
  { name: "Accounts", href: "/crm/accounts", iconName: "accounts" },
  { name: "Contacts", href: "/crm/contacts", iconName: "contacts" },
  { name: "Leads", href: "/crm/leads", iconName: "leads" },
  { name: "Opportunities", href: "/crm/opportunities", iconName: "opportunities" },
  { name: "Pipeline", href: "/crm/pipeline", iconName: "pipeline" },
];

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Role separation: getSuperAdminOrNull and getTenantAdminContextOrNull
  // are mutually exclusive at the data layer (Task 0 + Task 2), so at most
  // one of these is non-null for any user.
  const [superAdmin, tenantCtx] = await Promise.all([
    getSuperAdminOrNull(),
    getTenantContextOrNull(),
  ]);

  // WS6: resolve the palette PER REQUEST from THIS request's tenant context
  // (Condition 6 — getTenantContextOrNull is keyed to the request's Clerk org
  // and is not memoised, so no tenant's palette can leak into another's).
  const palette = readTenantPalette(tenantCtx?.tenant.settings);

  // Accent shortcut links — mutually exclusive (role separation guarantees at
  // most one of these is shown).
  const topItems: NavItem[] = [];
  if (superAdmin) {
    topItems.push({
      name: "Super Admin",
      href: "/super-admin",
      iconName: "shield",
      accent: true,
    });
  }
  if (tenantCtx?.permissions.has("admin.access")) {
    topItems.push({
      name: "Admin",
      href: "/admin",
      iconName: "shield",
      accent: true,
    });
  }

  return (
    <div data-palette={palette} className="flex h-screen flex-col md:flex-row">
      <PrimaryNav
        items={navigation}
        topItems={topItems}
        groupLabel="CRM"
        header={
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/dashboard"
            afterCreateOrganizationUrl="/dashboard"
            appearance={{
              elements: {
                rootBox: "w-full",
                organizationSwitcherTrigger: "w-full justify-between",
              },
            }}
          />
        }
        footer={
          <UserButton
            showName
            appearance={{
              elements: {
                rootBox: "w-full",
                userButtonTrigger: "w-full justify-start",
              },
            }}
          />
        }
      />

      {/* Main content — full-width, with internal scroll so pages can fill the
          viewport height (e.g. full-height list tables). */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--page-bg)]">
        <div className="min-h-0 flex-1 overflow-auto px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
