import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  Shield,
  Settings,
  ArrowLeft,
  Building2,
} from "lucide-react";
import { requireTenantAdmin } from "@/lib/tenant-admin";

const navigation = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { name: "Users", href: "/admin/users", icon: Users },
  { name: "Roles", href: "/admin/roles", icon: Shield },
  { name: "Settings", href: "/admin/settings", icon: Settings },
];

export default async function TenantAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { tenant, role } = await requireTenantAdmin();

  return (
    <div className="flex h-screen">
      <aside className="flex w-64 flex-col bg-brand-700 text-white">
        <div className="border-b border-white/10 p-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            <div className="min-w-0">
              <div
                className="truncate text-sm font-semibold tracking-wide"
                title={tenant.name}
              >
                {tenant.name}
              </div>
              <div className="text-xs text-white/60">{role.name}</div>
            </div>
          </div>
          <Link
            href="/dashboard"
            className="mt-3 flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to platform
          </Link>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10 transition-colors"
            >
              <item.icon className="h-4 w-4 text-white/70" />
              {item.name}
            </Link>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4">
          <UserButton
            showName
            appearance={{
              elements: {
                rootBox: "w-full",
                userButtonTrigger: "w-full justify-start",
                userButtonOuterIdentifier: "text-white",
              },
            }}
          />
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-[var(--background)]">
        <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
