import { NextRequest, NextResponse } from "next/server";
import {
  db,
  permissions,
  rolePermissions,
  roles,
  tenantMemberships,
  tenantModules,
} from "@adserve/database";
import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { apiRequireTenantAdmin } from "@/lib/tenant-admin";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function GET() {
  const guard = await apiRequireTenantAdmin();
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  const tenantRoles = await db
    .select()
    .from(roles)
    .where(eq(roles.tenantId, tenant.id))
    .orderBy(asc(roles.name));

  const memberCountRows = await db
    .select({
      roleId: tenantMemberships.roleId,
      n: count(),
    })
    .from(tenantMemberships)
    .where(eq(tenantMemberships.tenantId, tenant.id))
    .groupBy(tenantMemberships.roleId);
  const countByRole = new Map(memberCountRows.map((r) => [r.roleId, Number(r.n)]));

  return NextResponse.json({
    roles: tenantRoles.map((r) => ({
      ...r,
      memberCount: countByRole.get(r.id) ?? 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const guard = await apiRequireTenantAdmin();
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

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

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "Field 'name' is required." },
      { status: 400 }
    );
  }
  if (description !== undefined && description !== null && typeof description !== "string") {
    return NextResponse.json(
      { error: "Field 'description' must be a string." },
      { status: 400 }
    );
  }
  if (!Array.isArray(permissionIds) || !permissionIds.every((x) => typeof x === "string")) {
    return NextResponse.json(
      { error: "Field 'permissionIds' must be an array of strings." },
      { status: 400 }
    );
  }

  const slug = slugify(name);
  if (!slug) {
    return NextResponse.json(
      { error: "Name must contain at least one alphanumeric character." },
      { status: 400 }
    );
  }

  // Resolve which module IDs are enabled for this tenant
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

  // Validate every submitted permission ID is either platform-level or
  // belongs to an enabled module
  let validPerms: { id: string }[] = [];
  if (permissionIds.length > 0) {
    validPerms = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          inArray(permissions.id, permissionIds as string[]),
          enabledModuleIds.length > 0
            ? or(
                isNull(permissions.moduleId),
                inArray(permissions.moduleId, enabledModuleIds)
              )
            : isNull(permissions.moduleId)
        )
      );
    if (validPerms.length !== permissionIds.length) {
      return NextResponse.json(
        {
          error:
            "Some permissions are not visible to this tenant (disabled module or unknown id).",
        },
        { status: 400 }
      );
    }
  }

  try {
    const newRole = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(roles)
        .values({
          tenantId: tenant.id,
          name: name.trim(),
          slug,
          description: (description as string | null | undefined) ?? null,
          isSystem: false,
        })
        .returning();

      if (validPerms.length > 0) {
        await tx.insert(rolePermissions).values(
          validPerms.map((p) => ({
            roleId: created.id,
            permissionId: p.id,
          }))
        );
      }

      return created;
    });

    return NextResponse.json({ role: newRole });
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      return NextResponse.json(
        {
          error: `A role with slug "${slug}" already exists. Choose a different name.`,
        },
        { status: 409 }
      );
    }
    throw err;
  }
}
