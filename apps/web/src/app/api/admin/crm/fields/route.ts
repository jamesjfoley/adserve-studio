import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { fieldDefinitions, withTenant } from "@adserve/database";
import { resolveCrmEntitySlug } from "@adserve/crm";
import {
  createFieldDefinition,
  getEntityTypeBySlug,
} from "@adserve/module-framework";
import { apiRequirePermission } from "@/lib/permissions";
import { configErrorResponse } from "@/lib/crm/config-errors";

const SLUG_RE = /^[a-z][a-z0-9_]*$/;

/**
 * POST /api/admin/crm/fields — create a custom field on an entity type.
 * crm.admin only.
 */
export async function POST(req: NextRequest) {
  const guard = await apiRequirePermission("crm.admin");
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = resolveCrmEntitySlug(String(body.entityType ?? ""));
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const fieldSlug = typeof body.slug === "string" ? body.slug.trim() : "";
  const fieldType = typeof body.fieldType === "string" ? body.fieldType : "";
  if (!name) {
    return NextResponse.json({ error: "Field 'name' is required" }, { status: 400 });
  }
  if (!SLUG_RE.test(fieldSlug)) {
    return NextResponse.json(
      { error: "Field 'slug' must be lower_snake_case (start with a letter)" },
      { status: 400 }
    );
  }

  try {
    const row = await withTenant(tenant.id, async (tx) => {
      const entity = await getEntityTypeBySlug(tx, { tenantId: tenant.id, slug });
      if (!entity) return null;
      return createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: entity.id,
        name,
        slug: fieldSlug,
        fieldType: fieldType as Parameters<typeof createFieldDefinition>[1]["fieldType"],
        isRequired: body.isRequired === true,
        isFilterable: body.isFilterable === true,
        description:
          typeof body.description === "string" ? body.description : undefined,
        options:
          body.options && typeof body.options === "object"
            ? (body.options as Record<string, unknown>)
            : undefined,
        displayOrder:
          typeof body.displayOrder === "number" ? body.displayOrder : undefined,
        isSystem: false,
      });
    });
    if (!row) {
      return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
    }
    return NextResponse.json({ field: row }, { status: 201 });
  } catch (err) {
    return configErrorResponse(err);
  }
}

/**
 * PATCH — reorder fields: body { entityType, orderedFieldIds: string[] }.
 * Sets displayOrder = index for each, tenant-scoped. crm.admin only.
 */
export async function PATCH(req: NextRequest) {
  const guard = await apiRequirePermission("crm.admin");
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  let body: { entityType?: unknown; orderedFieldIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const slug = resolveCrmEntitySlug(String(body.entityType ?? ""));
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }
  if (
    !Array.isArray(body.orderedFieldIds) ||
    !body.orderedFieldIds.every((x) => typeof x === "string")
  ) {
    return NextResponse.json(
      { error: "Field 'orderedFieldIds' must be an array of strings" },
      { status: 400 }
    );
  }
  const orderedFieldIds = body.orderedFieldIds as string[];

  const outcome = await withTenant(tenant.id, async (tx) => {
    const entity = await getEntityTypeBySlug(tx, { tenantId: tenant.id, slug });
    if (!entity) return "no_entity" as const;
    // Update each field's displayOrder to its array index, scoped to the
    // tenant + entity type so foreign ids can't be touched.
    for (let i = 0; i < orderedFieldIds.length; i++) {
      await tx
        .update(fieldDefinitions)
        .set({ displayOrder: i, updatedAt: new Date() })
        .where(
          and(
            eq(fieldDefinitions.id, orderedFieldIds[i]),
            eq(fieldDefinitions.tenantId, tenant.id),
            eq(fieldDefinitions.entityTypeId, entity.id)
          )
        );
    }
    return "ok" as const;
  });

  if (outcome === "no_entity") {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
