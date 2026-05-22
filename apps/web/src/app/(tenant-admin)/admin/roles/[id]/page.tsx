import { notFound } from "next/navigation";
import { db, rolePermissions, roles } from "@adserve/database";
import { and, eq } from "drizzle-orm";
import { requireTenantAdmin } from "@/lib/tenant-admin";
import { RoleForm } from "../_components/role-form";
import { getVisiblePermissions } from "../_lib/visible-permissions";

type Params = { params: Promise<{ id: string }> };

export default async function EditRolePage({ params }: Params) {
  const { tenant } = await requireTenantAdmin();
  const { id } = await params;

  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.id, id), eq(roles.tenantId, tenant.id)));
  if (!role) notFound();

  const [allPermissions, currentPermRows] = await Promise.all([
    getVisiblePermissions(tenant.id),
    db
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, role.id)),
  ]);

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
