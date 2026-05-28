import { NextRequest, NextResponse } from "next/server";
import {
  tenants,
  tenantModules,
  modules,
  withSuperAdminBypass,
} from "@adserve/database";
import { eq } from "drizzle-orm";
import { apiRequireSuperAdmin } from "@/lib/super-admin";
import { loadTenantModuleStates } from "@/lib/super-admin-queries";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await apiRequireSuperAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;

  const data = await withSuperAdminBypass(async (tx) => {
    const [tenant] = await tx
      .select()
      .from(tenants)
      .where(eq(tenants.id, id));
    if (!tenant) return null;
    return loadTenantModuleStates(tx, id);
  });

  if (!data) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const result = data.map((m) => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    status: m.status,
    version: m.version,
    enabled: m.enabled,
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

  const result = await withSuperAdminBypass(async (tx) => {
    const [tenant] = await tx
      .select()
      .from(tenants)
      .where(eq(tenants.id, id));
    if (!tenant) return { error: "Tenant not found" as const, status: 404 };

    const [moduleRow] = await tx
      .select()
      .from(modules)
      .where(eq(modules.slug, moduleSlug));
    if (!moduleRow) return { error: "Module not found" as const, status: 404 };

    const [row] = await tx
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
    return { tenantModule: row };
  });

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }
  return NextResponse.json(result);
}
