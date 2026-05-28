import Link from "next/link";
import { notFound } from "next/navigation";
import { tenants, withSuperAdminBypass } from "@adserve/database";
import { eq } from "drizzle-orm";
import { EditTenantForm } from "./edit-tenant-form";

type Params = { params: Promise<{ id: string }> };

export default async function EditTenantPage({ params }: Params) {
  const { id } = await params;

  const [tenant] = await withSuperAdminBypass((tx) =>
    tx.select().from(tenants).where(eq(tenants.id, id))
  );
  if (!tenant) notFound();

  const settings = (tenant.settings ?? {}) as Record<string, unknown>;

  return (
    <div>
      <Link
        href={`/super-admin/tenants/${tenant.id}`}
        className="text-sm text-[var(--muted-foreground)] hover:underline"
      >
        ← {tenant.name}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Edit tenant
      </h1>
      <p className="mt-2 text-[var(--muted-foreground)]">
        Update tenant identity and locale settings. Status is changed via the
        action buttons on the detail page.
      </p>
      <EditTenantForm
        tenantId={tenant.id}
        initial={{
          name: tenant.name,
          slug: tenant.slug,
          timezone: (settings.timezone as string) ?? "",
          locale: (settings.locale as string) ?? "",
          currency: (settings.currency as string) ?? "",
        }}
      />
    </div>
  );
}
