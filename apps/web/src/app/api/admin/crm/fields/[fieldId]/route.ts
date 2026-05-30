import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@adserve/database";
import {
  deleteFieldDefinition,
  updateFieldDefinition,
} from "@adserve/module-framework";
import { apiRequirePermission } from "@/lib/permissions";
import { configErrorResponse } from "@/lib/crm/config-errors";

type Params = { params: Promise<{ fieldId: string }> };

/**
 * PATCH /api/admin/crm/fields/[fieldId] — update a field. The engine
 * protects system fields from fieldType changes (→ 422). crm.admin only.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await apiRequirePermission("crm.admin");
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;
  const { fieldId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string") updates.name = body.name.trim();
  if (body.labels && typeof body.labels === "object") updates.labels = body.labels;
  if (typeof body.description === "string" || body.description === null)
    updates.description = body.description;
  if (typeof body.displayOrder === "number")
    updates.displayOrder = body.displayOrder;
  if (typeof body.isRequired === "boolean") updates.isRequired = body.isRequired;
  if (typeof body.isFilterable === "boolean")
    updates.isFilterable = body.isFilterable;
  if (typeof body.fieldType === "string") updates.fieldType = body.fieldType;
  if (body.options && typeof body.options === "object")
    updates.options = body.options;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No updatable fields provided" },
      { status: 400 }
    );
  }

  try {
    const row = await withTenant(tenant.id, (tx) =>
      updateFieldDefinition(tx, {
        fieldId,
        tenantId: tenant.id,
        updates: updates as Parameters<
          typeof updateFieldDefinition
        >[1]["updates"],
      })
    );
    return NextResponse.json({ field: row });
  } catch (err) {
    return configErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/crm/fields/[fieldId] — delete a custom field. The engine
 * blocks system fields (403) and fields with data unless `?force=true` (409).
 * crm.admin only.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await apiRequirePermission("crm.admin");
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;
  const { fieldId } = await params;
  const force = new URL(req.url).searchParams.get("force") === "true";

  try {
    await withTenant(tenant.id, (tx) =>
      deleteFieldDefinition(tx, { fieldId, tenantId: tenant.id, force })
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return configErrorResponse(err);
  }
}
