import { NextRequest, NextResponse } from "next/server";
import {
  db,
  permissions,
  rolePermissions,
  roles,
  tenantMemberships,
  tenantModules,
} from "@adserve/database";
import { and, count, eq, inArray, isNull, or } from "drizzle-orm";
import { apiRequireTenantAdmin } from "@/lib/tenant-admin";

type Params = { params: Promise<{ id: string }> };

async function loadRole(tenantId: string, roleId: string) {
  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));
  return role ?? null;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await apiRequireTenantAdmin();
  if (guard.error) return guard.error;
  const { tenant, role: actorRole } = guard.ctx;
  const { id } = await params;

  const role = await loadRole(tenant.id, id);
  if (!role) {
    return NextResponse.json({ error: "Role not found." }, { status: 404 });
  }

  // Owner role is locked entirely (Q2).
  if (role.slug === "owner") {
    return NextResponse.json(
      { error: "The Owner role cannot be edited." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, description, permissionIds } = (body ?? {}) as {
    name?: unknown;
    description?: unknown;
    permissionIds?: unknown;
  };

  const updates: Record<string, unknown> = {};

  // Name / description: editable on custom roles only. System roles (Q1)
  // lock these but allow permission changes.
  if (name !== undefined) {
    if (role.isSystem) {
      return NextResponse.json(
        { error: "System role name cannot be changed." },
        { status: 403 }
      );
    }
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Field 'name' must be a non-empty string." },
        { status: 400 }
      );
    }
    updates.name = name.trim();
  }

  if (description !== undefined) {
    if (role.isSystem) {
      return NextResponse.json(
        { error: "System role description cannot be changed." },
        { status: 403 }
      );
    }
    if (description !== null && typeof description !== "string") {
      return NextResponse.json(
        { error: "Field 'description' must be a string or null." },
        { status: 400 }
      );
    }
    updates.description = description;
  }

  // Resolve enabled modules — needed for permission validation and lockout check
  const enabledModuleRows = await db
    .select({ moduleId: tenantModules.moduleId })
    .from(tenantModules)
    .where(
      and(
        eq(tenantModules.tenantId, tenant.id),
        eq(tenantModules.enabled, true)
      )
    );
  const enabledModuleIds = enabledModuleRows.map((r) => r.moduleId);

  let newPermissionIds: string[] | null = null;
  if (permissionIds !== undefined) {
    if (!Array.isArray(permissionIds) || !permissionIds.every((x) => typeof x === "string")) {
      return NextResponse.json(
        { error: "Field 'permissionIds' must be an array of strings." },
        { status: 400 }
      );
    }
    newPermissionIds = permissionIds as string[];

    // Self-lockout protection (Q10): if the actor's own role is being
    // edited and the new set drops admin.access, refuse.
    if (role.id === actorRole.id) {
      const [adminAccess] = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(
          and(
            eq(permissions.resource, "admin"),
            eq(permissions.action, "access")
          )
        );
      if (adminAccess && !newPermissionIds.includes(adminAccess.id)) {
        return NextResponse.json(
          {
            error:
              "Refusing to remove admin.access from your own role — you would lose access to /admin.",
          },
          { status: 400 }
        );
      }
    }

    // Validate every submitted permission is visible to this tenant
    if (newPermissionIds.length > 0) {
      const validPerms = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(
          and(
            inArray(permissions.id, newPermissionIds),
            enabledModuleIds.length > 0
              ? or(
                  isNull(permissions.moduleId),
                  inArray(permissions.moduleId, enabledModuleIds)
                )
              : isNull(permissions.moduleId)
          )
        );
      if (validPerms.length !== newPermissionIds.length) {
        return NextResponse.json(
          {
            error:
              "Some permissions are not visible to this tenant (disabled module or unknown id).",
          },
          { status: 400 }
        );
      }
    }
  }

  if (Object.keys(updates).length === 0 && newPermissionIds === null) {
    return NextResponse.json(
      { error: "No updatable fields provided." },
      { status: 400 }
    );
  }

  const updated = await db.transaction(async (tx) => {
    let next = role;
    if (Object.keys(updates).length > 0) {
      const [row] = await tx
        .update(roles)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(roles.id, role.id))
        .returning();
      next = row;
    }

    if (newPermissionIds !== null) {
      // Atomic replace (Q9)
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
      if (newPermissionIds.length > 0) {
        await tx.insert(rolePermissions).values(
          newPermissionIds.map((pid) => ({
            roleId: role.id,
            permissionId: pid,
          }))
        );
      }
    }

    return next;
  });

  return NextResponse.json({ role: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await apiRequireTenantAdmin();
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;
  const { id } = await params;

  const role = await loadRole(tenant.id, id);
  if (!role) {
    return NextResponse.json({ error: "Role not found." }, { status: 404 });
  }

  if (role.isSystem) {
    return NextResponse.json(
      { error: "System roles cannot be deleted." },
      { status: 403 }
    );
  }

  // Block delete if any memberships reference this role (Q8 — all statuses count)
  const [{ n }] = await db
    .select({ n: count() })
    .from(tenantMemberships)
    .where(eq(tenantMemberships.roleId, role.id));
  if (Number(n) > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete: ${n} user${Number(n) === 1 ? "" : "s"} are assigned to this role.`,
        memberCount: Number(n),
      },
      { status: 409 }
    );
  }

  // role_permissions cascades on role delete
  await db.delete(roles).where(eq(roles.id, role.id));
  return NextResponse.json({ ok: true });
}
