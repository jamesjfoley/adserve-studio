import { notFound } from "next/navigation";
import { requireTenantAdmin } from "@/lib/tenant-admin";
import { RoleForm } from "../_components/role-form";
import { loadAdminRoleEditData } from "@/lib/admin/loaders";

type Params = { params: Promise<{ id: string }> };

export default async function EditRolePage({ params }: Params) {
  const { tenant } = await requireTenantAdmin();
  const { id } = await params;

  const data = await loadAdminRoleEditData({ tenantId: tenant.id, roleId: id });

  if (!data) notFound();
  const { role, allPermissions, currentPermRows } = data;

  const isOwner = role.slug === "owner";
  const currentPermissionIds = currentPermRows.map((r) => r.permissionId);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        {isOwner ? "View role" : "Edit role"}: {role.name}
      </h1>
      <p className="mt-2 text-[var(--muted-foreground)]">
        {role.isSystem ? "System role." : "Custom role."}
      </p>

      <div className="mt-8">
        <RoleForm
          mode={{
            kind: "edit",
            roleId: role.id,
            isSystem: role.isSystem,
            isOwner,
          }}
          initialName={role.name}
          initialDescription={role.description ?? ""}
          initialPermissionIds={currentPermissionIds}
          allPermissions={allPermissions}
        />
      </div>
    </div>
  );
}
