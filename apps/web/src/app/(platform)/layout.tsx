import { UserButton, OrganizationSwitcher } from "@clerk/nextjs";
import Link from "next/link";
import {
  Users,
  Building2,
  UserPlus,
  TrendingUp,
  LayoutDashboard,
  Shield,
  KanbanSquare,
} from "lucide-react";
import { getSuperAdminOrNull } from "@/lib/super-admin";
import { getTenantAdminContextOrNull } from "@/lib/tenant-admin";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Accounts", href: "/crm/accounts", icon: Building2 },
  { name: "Contacts", href: "/crm/contacts", icon: Users },
  { name: "Leads", href: "/crm/leads", icon: UserPlus },
  { name: "Opportunities", href: "/crm/opportunities", icon: TrendingUp },
  { name: "Pipeline", href: "/crm/pipeline", icon: KanbanSquare },
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

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-[var(--border)] bg-[var(--muted)]">
        {/* Org switcher (tenant selector) */}
        <div className="border-b border-[var(--border)] p-4">
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
        </div>

        {superAdmin && (
          <div className="border-b border-[var(--border)] p-3">
            <Link
              href="/super-admin"
              className="flex items-center gap-3 rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 transition-colors"
            >
              <Shield className="h-4 w-4" />
              Super Admin
            </Link>
          </div>
        )}

        {tenantAdminCtx && (
          <div className="border-b border-[var(--border)] p-3">
            <Link
              href="/admin"
              className="flex items-center gap-3 rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 transition-colors"
            >
              <Shield className="h-4 w-4" />
              Admin
            </Link>
          </div>
        )}

        {/* Main navigation */}
        <nav className="flex-1 space-y-1 p-3">
          <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
            CRM
          </p>
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--background)] transition-colors"
            >
              <item.icon className="h-4 w-4 text-[var(--muted-foreground)]" />
              {item.name}
            </Link>
          ))}
        </nav>

        {/* User menu at bottom */}
        <div className="border-t border-[var(--border)] p-4">
          <UserButton
            showName
            appearance={{
              elements: {
                rootBox: "w-full",
                userButtonTrigger: "w-full justify-start",
              },
            }}
          />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
