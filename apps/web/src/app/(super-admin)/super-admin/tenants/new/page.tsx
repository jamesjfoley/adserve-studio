import Link from "next/link";
import { NewTenantForm } from "./new-tenant-form";

export default function NewTenantPage() {
  return (
    <div>
      <Link
        href="/super-admin/tenants"
        className="text-sm text-[var(--muted-foreground)] hover:underline"
      >
        ← All tenants
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Create tenant
      </h1>
      <p className="mt-2 text-[var(--muted-foreground)]">
        Provisions the tenant with default roles (owner, admin, member) and
        permission grants. Not linked to a Clerk organisation.
      </p>
      <NewTenantForm />
    </div>
  );
}
