import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@adserve/database";
import { updateLayoutConfig, type LayoutConfig } from "@adserve/module-framework";
import { apiRequirePermission } from "@/lib/permissions";
import { configErrorResponse } from "@/lib/crm/config-errors";

type Params = { params: Promise<{ layoutId: string }> };

/**
 * PATCH /api/admin/crm/layouts/[layoutId] — replace a layout's config. The
 * engine validates structure + that every fieldId exists tenant-scoped, with
 * no duplicates (→ 422 on failure). crm.admin only.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await apiRequirePermission("crm.admin");
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;
  const { layoutId } = await params;

  let body: { config?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const config = body.config as LayoutConfig | undefined;
  if (
    !config ||
    typeof config !== "object" ||
    !Array.isArray((config as LayoutConfig).sections)
  ) {
    return NextResponse.json(
      { error: "Field 'config' must be a layout config with a sections array" },
      { status: 400 }
    );
  }

  try {
    const layout = await withTenant(tenant.id, (tx) =>
      updateLayoutConfig(tx, { layoutId, tenantId: tenant.id, config })
    );
    return NextResponse.json({ layout });
  } catch (err) {
    return configErrorResponse(err);
  }
}
