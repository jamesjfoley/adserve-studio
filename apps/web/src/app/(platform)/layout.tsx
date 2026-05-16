import { UserButton, OrganizationSwitcher } from "@clerk/nextjs";
import Link from "next/link";
import {
  Users,
  Building2,
  TrendingUp,
  LayoutDashboard,
  Settings,
  Shield,
} from "lucide-react";
import { getSuperAdminOrNull } from "@/lib/super-admin";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Contacts", href: "/crm/contacts", icon: Users },
  { name: "Companies", href: "/crm/companies", icon: Building2 },
  { name: "Deals", href: "/crm/deals", icon: TrendingUp },
];

const adminNavigation = [
  { name: "Users & roles", href: "/admin/users", icon: Shield },
  { name: "Settings", href: "/admin/settings", icon: Settings },
];

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const superAdmin = await getSuperAdminOrNull();

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

          <p className="mb-2 mt-6 px-3 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
            Admin
          </p>
          {adminNavigation.map((item) => (
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
