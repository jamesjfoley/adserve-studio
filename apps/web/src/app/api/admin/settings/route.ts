import { NextRequest, NextResponse } from "next/server";
import {
  modules,
  tenants,
  tenantModules,
  withTenant,
} from "@adserve/database";
import { and, asc, eq } from "drizzle-orm";
import { apiRequireTenantAdmin } from "@/lib/tenant-admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+$/i;

export async function GET() {
  const guard = await apiRequireTenantAdmin();
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  const enabledModules = await withTenant(tenant.id, (tx) =>
    tx
      .select({
        id: modules.id,
        slug: modules.slug,
        name: modules.name,
        description: modules.description,
        enabledAt: tenantModules.enabledAt,
      })
      .from(tenantModules)
      .innerJoin(modules, eq(modules.id, tenantModules.moduleId))
      .where(
        and(
          eq(tenantModules.tenantId, tenant.id),
          eq(tenantModules.enabled, true)
        )
      )
      .orderBy(asc(modules.name))
  );

  return NextResponse.json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      contactEmail: tenant.contactEmail,
      phone: tenant.phone,
      address: tenant.address,
      logoUrl: tenant.logoUrl,
      createdAt: tenant.createdAt,
    },
    modules: enabledModules,
  });
}

export async function PATCH(req: NextRequest) {
  const guard = await apiRequireTenantAdmin();
  if (guard.error) return guard.error;
  const { tenant, permissions } = guard.ctx;

  // Q5: PATCH requires settings.admin in addition to admin.access.
  if (!permissions.has("settings.admin")) {
    return NextResponse.json(
      { error: "You do not have permission to edit tenant settings." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, contactEmail, phone, address, logoUrl } = (body ?? {}) as {
    name?: unknown;
    contactEmail?: unknown;
    phone?: unknown;
    address?: unknown;
    logoUrl?: unknown;
  };

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Field 'name' must be a non-empty string." },
        { status: 400 }
      );
    }
    updates.name = name.trim();
  }

  if (contactEmail !== undefined) {
    if (contactEmail === null || contactEmail === "") {
      updates.contactEmail = null;
    } else if (typeof contactEmail !== "string" || !EMAIL_RE.test(contactEmail)) {
      return NextResponse.json(
        { error: "Field 'contactEmail' must be a valid email or empty." },
        { status: 400 }
      );
    } else {
      updates.contactEmail = contactEmail;
    }
  }

  if (phone !== undefined) {
    if (phone !== null && typeof phone !== "string") {
      return NextResponse.json(
        { error: "Field 'phone' must be a string or null." },
        { status: 400 }
      );
    }
    updates.phone = phone === "" ? null : phone;
  }

  if (address !== undefined) {
    if (address !== null && typeof address !== "string") {
      return NextResponse.json(
        { error: "Field 'address' must be a string or null." },
        { status: 400 }
      );
    }
    updates.address = address === "" ? null : address;
  }

  if (logoUrl !== undefined) {
    if (logoUrl === null || logoUrl === "") {
      updates.logoUrl = null;
    } else if (typeof logoUrl !== "string" || !URL_RE.test(logoUrl)) {
      return NextResponse.json(
        { error: "Field 'logoUrl' must start with http:// or https://." },
        { status: 400 }
      );
    } else {
      updates.logoUrl = logoUrl;
    }
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json(
      { error: "No updatable fields provided." },
      { status: 400 }
    );
  }

  const [updated] = await withTenant(tenant.id, (tx) =>
    tx
      .update(tenants)
      .set(updates)
      .where(eq(tenants.id, tenant.id))
      .returning()
  );

  return NextResponse.json({ tenant: updated });
}
