import { NextRequest, NextResponse } from "next/server";
import { tenants, withSuperAdminBypass } from "@adserve/database";
import { eq } from "drizzle-orm";
import { apiRequireSuperAdmin } from "@/lib/super-admin";
import {
  loadTenantMembers,
  loadTenantModuleStates,
} from "@/lib/super-admin-queries";

type Params = { params: Promise<{ id: string }> };

const ALLOWED_STATUSES = ["active", "suspended", "cancelled"] as const;
type TenantStatus = (typeof ALLOWED_STATUSES)[number];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

    const [members, moduleList] = await Promise.all([
      loadTenantMembers(tx, id),
      loadTenantModuleStates(tx, id),
    ]);
    return { tenant, members, moduleList };
  });

  if (!data) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  return NextResponse.json({
    tenant: data.tenant,
    members: data.members,
    modules: data.moduleList,
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

  // Defer settings merge until inside the tx so the read-modify-write of
  // settings happens atomically with the UPDATE.
  const mergeSettingsInTx = settings !== undefined;
  if (mergeSettingsInTx) {
    if (typeof settings !== "object" || settings === null) {
      return NextResponse.json(
        { error: "Field 'settings' must be an object" },
        { status: 400 }
      );
    }
  }

  // Need to allow {updatedAt} + (optional settings) too — the settings
  // merge fills updates.settings later, so account for it here.
  if (Object.keys(updates).length === 1 && !mergeSettingsInTx) {
    return NextResponse.json(
      { error: "No updatable fields provided" },
      { status: 400 }
    );
  }

  try {
    const updated = await withSuperAdminBypass(async (tx) => {
      if (mergeSettingsInTx) {
        const [existing] = await tx
          .select({ settings: tenants.settings })
          .from(tenants)
          .where(eq(tenants.id, id));
        if (!existing) return null;
        const existingSettings = (existing.settings ?? {}) as Record<
          string,
          unknown
        >;
        const incoming = settings as Record<string, unknown>;
        // Strip protected fields
        delete incoming.clerkOrgId;
        updates.settings = { ...existingSettings, ...incoming };
      }
      const [row] = await tx
        .update(tenants)
        .set(updates)
        .where(eq(tenants.id, id))
        .returning();
      return row ?? null;
    });

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
