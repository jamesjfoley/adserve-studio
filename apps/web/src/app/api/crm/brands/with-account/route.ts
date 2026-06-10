import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { records, withTenant } from "@adserve/database";
import {
  coerceFieldValue,
  getEntityTypeBySlug,
  listFieldDefinitions,
} from "@adserve/module-framework";
import { BRAND_BELONGS_TO_ACCOUNT } from "@adserve/crm";
import { apiRequirePermission } from "@/lib/permissions";
import { serializeRecord } from "@/lib/crm/serialize";
import { writeAuditLog } from "@/lib/crm/audit";
import { createRecordLink, resolveRelationshipByName } from "@/lib/crm/link-records";

/**
 * POST /api/crm/brands/with-account — create a Brand and link it to its owning
 * Account (brand_belongs_to_account, M2O) in one withTenant tx. Brands are a
 * child of Account, created from the Account detail "Brands" panel; the owning
 * account id is supplied by that page.
 *
 * Body: { data: { name, category?, values? }, accountId }
 */
export async function POST(req: NextRequest) {
  const guard = await apiRequirePermission("brand.create");
  if (guard.error) return guard.error;
  const { tenant, user } = guard.ctx;

  let body: { data?: Record<string, unknown>; accountId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const input = body.data ?? {};
  const accountId =
    typeof body.accountId === "string" && body.accountId.trim() !== ""
      ? body.accountId
      : null;
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 422 });
  }

  const outcome = await withTenant(tenant.id, async (tx) => {
    const [brandEntity, accountEntity] = await Promise.all([
      getEntityTypeBySlug(tx, { tenantId: tenant.id, slug: "brand" }),
      getEntityTypeBySlug(tx, { tenantId: tenant.id, slug: "account" }),
    ]);
    if (!brandEntity || !accountEntity) return { kind: "not_activated" as const };

    // The owning account must resolve under RLS (rejects cross-tenant ids).
    const [account] = await tx
      .select({ id: records.id })
      .from(records)
      .where(
        and(
          eq(records.id, accountId),
          eq(records.tenantId, tenant.id),
          eq(records.entityTypeId, accountEntity.id)
        )
      );
    if (!account) return { kind: "invalid_account" as const };

    const fields = await listFieldDefinitions(tx, {
      tenantId: tenant.id,
      entityTypeId: brandEntity.id,
    });
    const data: Record<string, unknown> = {};
    const fieldErrors: Record<string, string> = {};
    for (const field of fields) {
      if (field.fieldType === "relationship") continue;
      const result = coerceFieldValue(field, input[field.slug]);
      if (!result.ok) fieldErrors[field.slug] = result.error.message;
      else if (result.value !== null) data[field.slug] = result.value;
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { kind: "invalid" as const, fieldErrors };
    }

    const [brand] = await tx
      .insert(records)
      .values({
        tenantId: tenant.id,
        entityTypeId: brandEntity.id,
        data,
        createdBy: user.id,
        updatedBy: user.id,
        ownedBy: user.id,
      })
      .returning();

    await writeAuditLog(tx, {
      tenantId: tenant.id,
      userId: user.id,
      action: "create",
      resourceType: "brand",
      resourceId: brand.id,
      changes: { after: brand.data },
    });

    const rel = await resolveRelationshipByName(
      tx,
      tenant.id,
      BRAND_BELONGS_TO_ACCOUNT.name
    );
    if (!rel) return { kind: "not_activated" as const };
    await createRecordLink(tx, {
      tenantId: tenant.id,
      userId: user.id,
      relationship: rel,
      sourceRecordId: brand.id,
      targetRecordId: accountId,
    });

    return { kind: "ok" as const, brand };
  });

  switch (outcome.kind) {
    case "not_activated":
      return NextResponse.json(
        { error: "CRM is not fully activated for this tenant" },
        { status: 409 }
      );
    case "invalid_account":
      return NextResponse.json(
        { error: "Selected account was not found", accountId },
        { status: 422 }
      );
    case "invalid":
      return NextResponse.json(
        { error: "Validation failed", fieldErrors: outcome.fieldErrors },
        { status: 422 }
      );
    case "ok":
      return NextResponse.json(
        { record: serializeRecord(outcome.brand) },
        { status: 201 }
      );
  }
}
