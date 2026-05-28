import { NextRequest, NextResponse } from "next/server";
import {
  db,
  permissions,
  rolePermissions,
  roles,
  tenantMemberships,
  withTenant,
} from "@adserve/database";
import { and, count, eq } from "drizzle-orm";
import { apiRequireTenantAdmin } from "@/lib/tenant-admin";
import { validatePermissionsForTenant } from "@/lib/role-permissions";

type Params = { params: Promise<{ id: string }> };

/**
 * Look up a role by id, scoped to a tenant. Takes a `tx` so the caller
 * owns the wrapper — see `withTenant` in `@adserve/database`.
 */
async function loadRole(tx: typeof db, tenantId: string, roleId: string) {
  const [role] = await tx
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

  // Validate permissionIds shape up-front (cheap and tx-independent).
  let newPermissionIds: string[] | null = null;
  if (permissionIds !== undefined) {
    if (
      !Array.isArray(permissionIds) ||
      !permissionIds.every((x) => typeof x === "string")
    ) {
      return NextResponse.json(
        { error: "Field 'permissionIds' must be an array of strings." },
        { status: 400 }
      );
    }
    newPermissionIds = permissionIds as string[];
  }

  type PatchOutcome =
    | { kind: "ok"; role: typeof roles.$inferSelect }
    | {
        kind: "error";
        status: number;
        message: string;
      };

  const outcome: PatchOutcome = await withTenant(tenant.id, async (tx) => {
    const role = await loadRole(tx, tenant.id, id);
    if (!role) return { kind: "error", status: 404, message: "Role not found." };

    // Owner role is locked entirely (Q2).
    if (role.slug === "owner") {
      return {
        kind: "error",
        status: 403,
        message: "The Owner role cannot be edited.",
      };
    }

    const updates: Record<string, unknown> = {};

    // Name / description: editable on custom roles only. System roles (Q1)
    // lock these but allow permission changes.
    if (name !== undefined) {
      if (role.isSystem) {
        return {
          kind: "error",
          status: 403,
          message: "System role name cannot be changed.",
        };
      }
      if (typeof name !== "string" || name.trim().length === 0) {
        return {
          kind: "error",
          status: 400,
          message: "Field 'name' must be a non-empty string.",
        };
      }
      updates.name = name.trim();
    }

    if (description !== undefined) {
      if (role.isSystem) {
        return {
          kind: "error",
          status: 403,
          message: "System role description cannot be changed.",
        };
      }
      if (description !== null && typeof description !== "string") {
        return {
          kind: "error",
          status: 400,
          message: "Field 'description' must be a string or null.",
        };
      }
      updates.description = description;
    }

    if (newPermissionIds !== null) {
      // Self-lockout protection (Q10): if the actor's own role is being
      // edited and the new set drops admin.access, refuse. permissions
      // table is not RLS-protected, so this lookup works inside the tx.
      if (role.id === actorRole.id) {
        const [adminAccess] = await tx
          .select({ id: permissions.id })
          .from(permissions)
          .where(
            and(
              eq(permissions.resource, "admin"),
              eq(permissions.action, "access")
            )
          );
        if (adminAccess && !newPermissionIds.includes(adminAccess.id)) {
          return {
            kind: "error",
            status: 400,
            message:
              "Refusing to remove admin.access from your own role — you would lose access to /admin.",
          };
        }
      }

      // Validate every submitted permission is visible to this tenant
      const validation = await validatePermissionsForTenant(
        tx,
        tenant.id,
        newPermissionIds
      );
      if (!validation.ok) {
        return {
          kind: "error",
          status: 400,
          message:
            "Some permissions are not visible to this tenant (disabled module or unknown id).",
        };
      }
    }

    if (Object.keys(updates).length === 0 && newPermissionIds === null) {
      return {
        kind: "error",
        status: 400,
        message: "No updatable fields provided.",
      };
    }

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
      await tx
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, role.id));
      if (newPermissionIds.length > 0) {
        await tx.insert(rolePermissions).values(
          newPermissionIds.map((pid) => ({
            roleId: role.id,
            permissionId: pid,
          }))
        );
      }
    }

    return { kind: "ok", role: next };
  });

  if (outcome.kind === "error") {
    return NextResponse.json(
      { error: outcome.message },
      { status: outcome.status }
    );
  }
  return NextResponse.json({ role: outcome.role });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await apiRequireTenantAdmin();
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;
  const { id } = await params;

  type DeleteOutcome =
    | { kind: "ok" }
    | { kind: "error"; status: number; message: string; memberCount?: number };

  const outcome: DeleteOutcome = await withTenant(tenant.id, async (tx) => {
    const role = await loadRole(tx, tenant.id, id);
    if (!role) {
      return { kind: "error", status: 404, message: "Role not found." };
    }

    if (role.isSystem) {
      return {
        kind: "error",
        status: 403,
        message: "System roles cannot be deleted.",
      };
    }

    // Block delete if any memberships reference this role (Q8 — all statuses count)
    const [{ n }] = await tx
      .select({ n: count() })
      .from(tenantMemberships)
      .where(eq(tenantMemberships.roleId, role.id));
    if (Number(n) > 0) {
      return {
        kind: "error",
        status: 409,
        message: `Cannot delete: ${n} user${Number(n) === 1 ? "" : "s"} are assigned to this role.`,
        memberCount: Number(n),
      };
    }

    // role_permissions cascades on role delete
    await tx.delete(roles).where(eq(roles.id, role.id));
    return { kind: "ok" };
  });

  if (outcome.kind === "error") {
    return NextResponse.json(
      {
        error: outcome.message,
        ...(outcome.memberCount !== undefined
          ? { memberCount: outcome.memberCount }
          : {}),
      },
      { status: outcome.status }
    );
  }

  return NextResponse.json({ ok: true });
}
