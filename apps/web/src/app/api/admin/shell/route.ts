import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { tenants, withTenant } from "@adserve/database";
import { eq } from "drizzle-orm";
import { getTenantContextOrNull } from "@/lib/permissions";

/**
 * Tenant branding + title-bar shell settings write.
 *
 * Mirrors the WS6 palette precedent (`/api/admin/theme`): authorised
 * server-side (tenant.admin OR crm.admin — NOT merely by hiding the form),
 * validated, then MERGED into the existing `tenants.settings` JSONB (preserving
 * clerkOrgId, theme, modules, and any other keys) inside withTenant.
 *
 *   settings.branding.logoUrl     — data:image/… or http(s) URL, or null/absent
 *   settings.shell.titleBarMode   — "always" | "auto-hide" (default "always")
 *
 * These are settings keys only — no table/migration.
 */

// Bound base64 data URLs to a few hundred KB so a single oversized logo can't
// bloat the tenants row. ~700k chars of base64 ≈ ~520KB decoded.
const MAX_LOGO_URL_LENGTH = 700_000;

type TitleBarMode = "always" | "auto-hide";

function isValidLogoUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length > MAX_LOGO_URL_LENGTH) return false;
  return (
    value.startsWith("data:image/") ||
    value.startsWith("http://") ||
    value.startsWith("https://")
  );
}

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

  const raw = (body ?? {}) as Record<string, unknown>;

  // Validate titleBarMode when provided — must be one of the two values.
  let titleBarMode: TitleBarMode | undefined;
  if ("titleBarMode" in raw) {
    if (raw.titleBarMode !== "always" && raw.titleBarMode !== "auto-hide") {
      return NextResponse.json(
        { error: 'Field "titleBarMode" must be "always" or "auto-hide"' },
        { status: 400 }
      );
    }
    titleBarMode = raw.titleBarMode;
  }

  // Validate logoUrl when provided — a bounded data:/http(s) string, or
  // explicitly null to clear it.
  let logoUrl: string | null | undefined;
  if ("logoUrl" in raw) {
    if (raw.logoUrl === null) {
      logoUrl = null;
    } else if (isValidLogoUrl(raw.logoUrl)) {
      logoUrl = raw.logoUrl;
    } else {
      return NextResponse.json(
        {
          error:
            'Field "logoUrl" must be a data:image/ or http(s) URL (max 700000 chars), or null',
        },
        { status: 400 }
      );
    }
  }

  // Merge into the existing settings JSONB — preserving clerkOrgId (the
  // tenant-resolution key), theme, modules, and any other settings keys.
  const currentSettings = (ctx.tenant.settings ?? {}) as Record<string, unknown>;
  const currentBranding = (currentSettings.branding ?? {}) as Record<
    string,
    unknown
  >;
  const currentShell = (currentSettings.shell ?? {}) as Record<string, unknown>;

  const nextSettings = {
    ...currentSettings,
    branding: {
      ...currentBranding,
      ...(logoUrl !== undefined ? { logoUrl } : {}),
    },
    shell: {
      ...currentShell,
      ...(titleBarMode ? { titleBarMode } : {}),
    },
  };

  await withTenant(ctx.tenant.id, (tx) =>
    tx
      .update(tenants)
      .set({ settings: nextSettings })
      .where(eq(tenants.id, ctx.tenant.id))
  );

  return NextResponse.json({
    logoUrl: (nextSettings.branding as { logoUrl?: string | null }).logoUrl ?? null,
    titleBarMode:
      (nextSettings.shell as { titleBarMode?: TitleBarMode }).titleBarMode ??
      "always",
  });
}
