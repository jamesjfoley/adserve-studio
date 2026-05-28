import { NextRequest, NextResponse } from "next/server";
import {
  rolePermissions,
  roles,
  tenantMemberships,
  withTenant,
} from "@adserve/database";
import { asc, count, eq } from "drizzle-orm";
import { apiRequireTenantAdmin } from "@/lib/tenant-admin";
import { validatePermissionsForTenant } from "@/lib/role-permissions";

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

  const { tenantRoles, memberCountRows } = await withTenant(
    tenant.id,
    async (tx) => {
      const tenantRoles = await tx
        .select()
        .from(roles)
        .where(eq(roles.tenantId, tenant.id))
        .orderBy(asc(roles.name));

      const memberCountRows = await tx
        .select({
          roleId: tenantMemberships.roleId,
          n: count(),
        })
        .from(tenantMemberships)
        .where(eq(tenantMemberships.tenantId, tenant.id))
        .groupBy(tenantMemberships.roleId);
      return { tenantRoles, memberCountRows };
    }
  );
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

  try {
    const result = await withTenant(tenant.id, async (tx) => {
      const validation = await validatePermissionsForTenant(
        tx,
        tenant.id,
        permissionIds as string[]
      );
      if (!validation.ok) return { error: "invalid_permissions" as const };

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

      if (validation.permissionIds.length > 0) {
        await tx.insert(rolePermissions).values(
          validation.permissionIds.map((pid) => ({
            roleId: created.id,
            permissionId: pid,
          }))
        );
      }

      return { role: created };
    });

    if ("error" in result) {
      return NextResponse.json(
        {
          error:
            "Some permissions are not visible to this tenant (disabled module or unknown id).",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ role: result.role });
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
