import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { tenants, withTenant } from "@adserve/database";
import { eq } from "drizzle-orm";
import { getTenantContextOrNull } from "@/lib/permissions";
import { isPaletteId } from "@/lib/theme/palettes";

/**
 * WS6 — set the org's accent palette (tenants.settings.theme.palette).
 *
 * Authorised server-side by tenant.admin OR crm.admin (Locked Decision 4) —
 * NOT merely by hiding the picker. The chosen id is validated against the
 * catalog enum; anything else is rejected. The write merges into the existing
 * settings JSONB (preserving clerkOrgId and any other keys) inside withTenant.
 */
export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const ctx = await getTenantContextOrNull();
  if (
    !ctx ||
    !(ctx.permissions.has("tenant.admin") || ctx.permissions.has("crm.admin"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const palette = (body as { palette?: unknown } | null | undefined)?.palette;
  if (!isPaletteId(palette)) {
    return NextResponse.json({ error: "Unknown palette" }, { status: 400 });
  }

  // Merge into the existing settings JSONB — must preserve clerkOrgId (the
  // tenant-resolution key) and any other settings.
  const currentSettings = (ctx.tenant.settings ?? {}) as Record<string, unknown>;
  const currentTheme = (currentSettings.theme ?? {}) as Record<string, unknown>;
  const nextSettings = {
    ...currentSettings,
    theme: { ...currentTheme, palette },
  };

  await withTenant(ctx.tenant.id, (tx) =>
    tx
      .update(tenants)
      .set({ settings: nextSettings })
      .where(eq(tenants.id, ctx.tenant.id))
  );

  return NextResponse.json({ palette });
}
