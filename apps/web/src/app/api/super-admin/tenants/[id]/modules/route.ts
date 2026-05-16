import { NextRequest, NextResponse } from "next/server";
import { db, tenants, tenantModules, modules } from "@adserve/database";
import { eq } from "drizzle-orm";
import { apiRequireSuperAdmin } from "@/lib/super-admin";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await apiRequireSuperAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const enabledRows = await db
    .select({
      moduleId: tenantModules.moduleId,
      enabled: tenantModules.enabled,
    })
    .from(tenantModules)
    .where(eq(tenantModules.tenantId, id));

  const enabledMap = new Map(enabledRows.map((r) => [r.moduleId, r.enabled]));

  const allModules = await db.select().from(modules);

  const result = allModules
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      status: m.status,
      version: m.version,
      enabled: enabledMap.get(m.id) === true,
    }));

  return NextResponse.json({ modules: result });
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

  const { moduleSlug, enabled } = (body ?? {}) as {
    moduleSlug?: unknown;
    enabled?: unknown;
  };

  if (typeof moduleSlug !== "string" || moduleSlug.length === 0) {
    return NextResponse.json(
      { error: "Field 'moduleSlug' is required" },
      { status: 400 }
    );
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json(
      { error: "Field 'enabled' must be a boolean" },
      { status: 400 }
    );
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const [moduleRow] = await db
    .select()
    .from(modules)
    .where(eq(modules.slug, moduleSlug));
  if (!moduleRow) {
    return NextResponse.json({ error: "Module not found" }, { status: 404 });
  }

  const [row] = await db
    .insert(tenantModules)
    .values({
      tenantId: id,
      moduleId: moduleRow.id,
      enabled,
    })
    .onConflictDoUpdate({
      target: [tenantModules.tenantId, tenantModules.moduleId],
      set: { enabled },
    })
    .returning();

  return NextResponse.json({ tenantModule: row });
}
