import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { tenants, withTenant } from "@adserve/database";
import { eq } from "drizzle-orm";
import { getTenantContextOrNull } from "@/lib/permissions";
import {
  readCrmModuleConfig,
  type ConvertTarget,
  type CrmModuleToggles,
} from "@/lib/crm/module-config";

/**
 * CRM module visibility + Lead-convert target write.
 *
 * Mirrors the WS6 palette precedent (`/api/admin/theme`): authorised
 * server-side (NOT merely by hiding the form), validated, then MERGED into the
 * existing `tenants.settings` JSONB (preserving clerkOrgId, theme, and any
 * other keys) inside withTenant. The toggles live at
 * `tenants.settings.modules.crm` — a settings key, no table/migration.
 *
 * Per the brief the WRITE is gated on `crm.admin` (owner/admin only).
 */

export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const ctx = await getTenantContextOrNull();
  if (!ctx || !ctx.permissions.has("crm.admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;

  // Validate each provided field. Booleans must be booleans; convertTarget must
  // be one of the two enum values. Anything else → 400. Omitted fields keep
  // their current value.
  for (const key of ["leads", "campaigns", "opportunities"] as const) {
    if (key in raw && typeof raw[key] !== "boolean") {
      return NextResponse.json(
        { error: `Field "${key}" must be a boolean` },
        { status: 400 }
      );
    }
  }
  if (
    "convertTarget" in raw &&
    raw.convertTarget !== "campaign" &&
    raw.convertTarget !== "opportunity"
  ) {
    return NextResponse.json(
      { error: 'Field "convertTarget" must be "campaign" or "opportunity"' },
      { status: 400 }
    );
  }

  // Seed from current config so omitted fields are preserved.
  const current = readCrmModuleConfig(ctx.tenant.settings);
  const next: CrmModuleToggles = {
    leads: typeof raw.leads === "boolean" ? raw.leads : current.leads,
    campaigns:
      typeof raw.campaigns === "boolean" ? raw.campaigns : current.campaigns,
    opportunities:
      typeof raw.opportunities === "boolean"
        ? raw.opportunities
        : current.opportunities,
    convertTarget:
      raw.convertTarget === "opportunity" || raw.convertTarget === "campaign"
        ? (raw.convertTarget as ConvertTarget)
        : current.convertTarget,
  };

  // Merge into the existing settings JSONB — preserving clerkOrgId (the
  // tenant-resolution key), theme, and any other settings keys.
  const currentSettings = (ctx.tenant.settings ?? {}) as Record<string, unknown>;
  const currentModules = (currentSettings.modules ?? {}) as Record<
    string,
    unknown
  >;
  const nextSettings = {
    ...currentSettings,
    modules: { ...currentModules, crm: next },
  };

  await withTenant(ctx.tenant.id, (tx) =>
    tx
      .update(tenants)
      .set({ settings: nextSettings })
      .where(eq(tenants.id, ctx.tenant.id))
  );

  return NextResponse.json(next);
}
