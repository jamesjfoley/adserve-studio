import { UserButton, OrganizationSwitcher } from "@clerk/nextjs";
import { getSuperAdminOrNull } from "@/lib/super-admin";
import { getTenantContextOrNull } from "@/lib/permissions";
import { PrimaryNav, type NavItem } from "@/components/nav/primary-nav";
import { readTenantPalette } from "@/lib/theme/palettes";
import { readCrmModuleConfig } from "@/lib/crm/module-config";
import { TitleBar } from "@/components/shell/title-bar";
import {
  getTenantModules,
  readShellConfig,
  userInitials,
  APP_VERSION,
  type ShellModule,
} from "@/lib/shell";

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

  // Media-first module visibility, resolved per request from the SAME tenant
  // context (no caching, mirrors the palette). Filtering the nav here — in the
  // server layout, before render — means disabled modules never flash.
  // Platform title-bar shell (above every module surface). Modules → candy box;
  // logo + display mode from tenant settings; initials from the signed-in user.
  const shell = readShellConfig(tenantCtx?.tenant.settings);
  const shellModules: ShellModule[] = tenantCtx
    ? await getTenantModules(tenantCtx.tenant.id)
    : [];
  const shellUser = tenantCtx?.user ?? superAdmin ?? null;

  const crm = readCrmModuleConfig(tenantCtx?.tenant.settings);
  const navigation: NavItem[] = [
    { name: "Dashboard", href: "/dashboard", iconName: "dashboard" },
    { name: "Accounts", href: "/crm/accounts", iconName: "accounts" },
    { name: "Contacts", href: "/crm/contacts", iconName: "contacts" },
    ...(crm.leads
      ? [{ name: "Leads", href: "/crm/leads", iconName: "leads" } as NavItem]
      : []),
    ...(crm.campaigns
      ? [{ name: "Campaigns", href: "/crm/campaigns", iconName: "campaigns" } as NavItem]
      : []),
    ...(crm.opportunities
      ? [
          {
            name: "Opportunities",
            href: "/crm/opportunities",
            iconName: "opportunities",
          } as NavItem,
        ]
      : []),
    ...(crm.showPipeline
      ? [
          { name: "Pipeline", href: "/crm/pipeline", iconName: "pipeline" } as NavItem,
          { name: "CRM Dashboard", href: "/crm", iconName: "dashboard" } as NavItem,
        ]
      : []),
  ];

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
    <div data-palette={palette} className="flex h-screen flex-col">
      <TitleBar
        modules={shellModules}
        logoUrl={shell.logoUrl}
        moduleName="CRM"
        initials={userInitials(shellUser?.fullName, shellUser?.email)}
        userName={shellUser?.fullName ?? shellUser?.email ?? ""}
        version={APP_VERSION}
        defaultMode={shell.titleBarMode}
        storageScope={shellUser?.id}
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
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
    </div>
  );
}
