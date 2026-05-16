import { NextRequest, NextResponse } from "next/server";
import {
  db,
  tenants,
  tenantMemberships,
  tenantModules,
  modules,
  users,
  roles,
} from "@adserve/database";
import { eq, desc } from "drizzle-orm";
import { apiRequireSuperAdmin } from "@/lib/super-admin";

type Params = { params: Promise<{ id: string }> };

const ALLOWED_STATUSES = ["active", "suspended", "cancelled"] as const;
type TenantStatus = (typeof ALLOWED_STATUSES)[number];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await apiRequireSuperAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const members = await db
    .select({
      membershipId: tenantMemberships.id,
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      userStatus: users.status,
      membershipStatus: tenantMemberships.status,
      roleSlug: roles.slug,
      roleName: roles.name,
      joinedAt: tenantMemberships.joinedAt,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
    .where(eq(tenantMemberships.tenantId, id))
    .orderBy(desc(tenantMemberships.joinedAt));

  const enabledRows = await db
    .select({
      moduleId: tenantModules.moduleId,
      enabled: tenantModules.enabled,
    })
    .from(tenantModules)
    .where(eq(tenantModules.tenantId, id));

  const enabledMap = new Map(enabledRows.map((r) => [r.moduleId, r.enabled]));

  const allModules = await db
    .select({
      id: modules.id,
      slug: modules.slug,
      name: modules.name,
      status: modules.status,
      version: modules.version,
      displayOrder: modules.displayOrder,
    })
    .from(modules);

  const moduleList = allModules
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((m) => ({ ...m, enabled: enabledMap.get(m.id) === true }));

  return NextResponse.json({
    tenant,
    members,
    modules: moduleList,
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await apiRequireSuperAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { status, name, slug, settings } = (body ?? {}) as {
    status?: unknown;
    name?: unknown;
    slug?: unknown;
    settings?: unknown;
  };

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (status !== undefined) {
    if (
      typeof status !== "string" ||
      !ALLOWED_STATUSES.includes(status as TenantStatus)
    ) {
      return NextResponse.json(
        { error: `Field 'status' must be one of: ${ALLOWED_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }
    updates.status = status;
  }

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Field 'name' must be a non-empty string" },
        { status: 400 }
      );
    }
    updates.name = name.trim();
  }

  if (slug !== undefined) {
    if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: "Field 'slug' must be kebab-case (a-z, 0-9, hyphens)" },
        { status: 400 }
      );
    }
    updates.slug = slug;
  }

  if (settings !== undefined) {
    if (typeof settings !== "object" || settings === null) {
      return NextResponse.json(
        { error: "Field 'settings' must be an object" },
        { status: 400 }
      );
    }
    const [existing] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, id));
    if (!existing) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }
    const existingSettings = (existing.settings ?? {}) as Record<
      string,
      unknown
    >;
    const incoming = settings as Record<string, unknown>;
    // Strip protected fields
    delete incoming.clerkOrgId;
    updates.settings = { ...existingSettings, ...incoming };
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json(
      { error: "No updatable fields provided" },
      { status: 400 }
    );
  }

  try {
    const [updated] = await db
      .update(tenants)
      .set(updates)
      .where(eq(tenants.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }
    return NextResponse.json({ tenant: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("tenants_slug_unique")) {
      return NextResponse.json(
        { error: "A tenant with this slug already exists" },
        { status: 409 }
      );
    }
    console.error("Failed to update tenant:", err);
    return NextResponse.json(
      { error: "Failed to update tenant" },
      { status: 500 }
    );
  }
}
