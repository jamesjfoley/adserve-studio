import { requireTenantAdmin } from "@/lib/tenant-admin";
import { RoleForm } from "../_components/role-form";
import { loadAdminNewRoleData } from "@/lib/admin/loaders";

export default async function NewRolePage() {
  const { tenant } = await requireTenantAdmin();
  const allPermissions = await loadAdminNewRoleData(tenant.id);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create role</h1>
      <p className="mt-2 text-[var(--muted-foreground)]">
        Define a new role for {tenant.name}. You can adjust permissions later.
      </p>

      <div className="mt-8">
        <RoleForm
          mode={{ kind: "create" }}
          initialName=""
          initialDescription=""
          initialPermissionIds={[]}
          allPermissions={allPermissions}
        />
      </div>
    </div>
  );
}
