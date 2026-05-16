import { NextRequest, NextResponse } from "next/server";
import { db, tenants } from "@adserve/database";
import { desc, sql } from "drizzle-orm";
import { apiRequireSuperAdmin } from "@/lib/super-admin";
import { provisionTenant } from "@/lib/tenant-provision";

export async function GET() {
  const auth = await apiRequireSuperAdmin();
  if (auth.error) return auth.error;

  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      settings: tenants.settings,
      createdAt: tenants.createdAt,
      userCount: sql<number>`(SELECT COUNT(*)::int FROM tenant_memberships WHERE tenant_id = "tenants"."id")`,
      moduleCount: sql<number>`(SELECT COUNT(*)::int FROM tenant_modules WHERE tenant_id = "tenants"."id" AND enabled = true)`,
    })
    .from(tenants)
    .orderBy(desc(tenants.createdAt));

  return NextResponse.json({ tenants: rows });
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function POST(req: NextRequest) {
  const auth = await apiRequireSuperAdmin();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, slug, settings } = (body ?? {}) as {
    name?: unknown;
    slug?: unknown;
    settings?: unknown;
  };

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "Field 'name' is required" },
      { status: 400 }
    );
  }
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return NextResponse.json(
      { error: "Field 'slug' must be kebab-case (a-z, 0-9, hyphens)" },
      { status: 400 }
    );
  }

  const cleanSettings: Record<string, unknown> = {};
  if (settings && typeof settings === "object") {
    for (const key of ["timezone", "locale", "currency"] as const) {
      const v = (settings as Record<string, unknown>)[key];
      if (typeof v === "string" && v.length > 0) cleanSettings[key] = v;
    }
  }

  try {
    const tenant = await provisionTenant({
      name: name.trim(),
      slug,
      settings: cleanSettings,
    });
    return NextResponse.json({ tenant }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("tenants_slug_unique")) {
      return NextResponse.json(
        { error: "A tenant with this slug already exists" },
        { status: 409 }
      );
    }
    console.error("Failed to provision tenant:", err);
    return NextResponse.json(
      { error: "Failed to create tenant" },
      { status: 500 }
    );
  }
}
