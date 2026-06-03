import { UserButton, OrganizationSwitcher } from "@clerk/nextjs";
import { getSuperAdminOrNull } from "@/lib/super-admin";
import { getTenantAdminContextOrNull } from "@/lib/tenant-admin";
import { PrimaryNav, type NavItem } from "@/components/nav/primary-nav";

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
  const [superAdmin, tenantAdminCtx] = await Promise.all([
    getSuperAdminOrNull(),
    getTenantAdminContextOrNull(),
  ]);

  // Accent shortcut links — mutually exclusive (role separation guarantees at
  // most one of these contexts is non-null).
  const topItems: NavItem[] = [];
  if (superAdmin) {
    topItems.push({
      name: "Super Admin",
      href: "/super-admin",
      iconName: "shield",
      accent: true,
    });
  }
  if (tenantAdminCtx) {
    topItems.push({
      name: "Admin",
      href: "/admin",
      iconName: "shield",
      accent: true,
    });
  }

  return (
    <div className="flex h-screen flex-col md:flex-row">
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

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
