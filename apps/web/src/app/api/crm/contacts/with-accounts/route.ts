import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { records, withTenant } from "@adserve/database";
import { CONTACT_BELONGS_TO_ACCOUNT } from "@adserve/crm";
import {
  coerceFieldValue,
  getEntityTypeBySlug,
  listFieldDefinitions,
} from "@adserve/module-framework";
import { apiRequirePermission } from "@/lib/permissions";
import { serializeRecord } from "@/lib/crm/serialize";
import { writeAuditLog } from "@/lib/crm/audit";
import {
  createRecordLink,
  resolveRelationshipByName,
} from "@/lib/crm/link-records";

/**
 * POST /api/crm/contacts/with-accounts — WS3 combined contact-create endpoint.
 *
 * Creates a contact AND links it to the user-selected account(s) via the
 * `contact_belongs_to_account` relationship inside ONE `withTenant`
 * transaction, so there is never a half-created contact with no account when a
 * link fails (all-or-nothing). Runs under `contact.create`; the create-time
 * owner is the acting user, so the ownership escape-hatch is moot at create.
 *
 * Body: { data: Record<string, unknown>, accountIds?: string[] }
 *
 * Every selected accountId is resolved under the caller's `withTenant`
 * context: a cross-tenant id returns zero rows under RLS and is rejected (the
 * whole transaction aborts → no contact, no links). Zero accountIds is allowed
 * (creates an unlinked contact). The combined endpoint does the relationship
 * inserts directly in the tx (via the shared `createRecordLink` writer) — it
 * never HTTP-calls the WS2 endpoint.
 */
export async function POST(req: NextRequest) {
  const guard = await apiRequirePermission("contact.create");
  if (guard.error) return guard.error;
  const { tenant, user } = guard.ctx;

  let body: { data?: Record<string, unknown>; accountIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const input = body.data ?? {};

  // Normalise accountIds → a de-duplicated array of non-empty strings.
  const rawAccountIds = Array.isArray(body.accountIds) ? body.accountIds : [];
  const accountIds = Array.from(
    new Set(
      rawAccountIds.filter(
        (v): v is string => typeof v === "string" && v.trim() !== ""
      )
    )
  );

  const outcome = await withTenant(tenant.id, async (tx) => {
    const contactEntity = await getEntityTypeBySlug(tx, {
      tenantId: tenant.id,
      slug: "contact",
    });
    if (!contactEntity) return { kind: "not_activated" as const };

    const fields = await listFieldDefinitions(tx, {
      tenantId: tenant.id,
      entityTypeId: contactEntity.id,
    });

    const data: Record<string, unknown> = {};
    const fieldErrors: Record<string, string> = {};
    for (const field of fields) {
      const result = coerceFieldValue(field, input[field.slug]);
      if (!result.ok) {
        fieldErrors[field.slug] = result.error.message;
      } else if (result.value !== null) {
        data[field.slug] = result.value;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { kind: "invalid" as const, fieldErrors };
    }

    // Resolve the contact↔account relationship + the account entity type once.
    let rel: Awaited<ReturnType<typeof resolveRelationshipByName>> = null;
    if (accountIds.length > 0) {
      rel = await resolveRelationshipByName(
        tx,
        tenant.id,
        CONTACT_BELONGS_TO_ACCOUNT.name
      );
      if (!rel) return { kind: "not_activated" as const };

      // Resolve all selected accounts under the caller's tenant context. A
      // cross-tenant id yields zero rows under RLS, so the resolved set is
      // smaller than the requested set → reject (no partial linking).
      const accountRows = await tx
        .select({ id: records.id, entityTypeId: records.entityTypeId })
        .from(records)
        .where(
          and(
            eq(records.tenantId, tenant.id),
            eq(records.entityTypeId, rel.targetEntityTypeId),
            inArray(records.id, accountIds)
          )
        );
      const resolvedIds = new Set(accountRows.map((r) => r.id));
      const missing = accountIds.filter((id) => !resolvedIds.has(id));
      if (missing.length > 0) {
        return { kind: "invalid_account" as const, missing };
      }
    }

    const [contact] = await tx
      .insert(records)
      .values({
        tenantId: tenant.id,
        entityTypeId: contactEntity.id,
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
      resourceType: "contact",
      resourceId: contact.id,
      changes: { after: contact.data },
    });

    // Link the contact to each selected account (contact is the SOURCE side of
    // contact_belongs_to_account). Same tx → atomic with the create.
    if (rel && accountIds.length > 0) {
      for (const accountId of accountIds) {
        await createRecordLink(tx, {
          tenantId: tenant.id,
          userId: user.id,
          relationship: rel,
          sourceRecordId: contact.id,
          targetRecordId: accountId,
        });
      }
    }

    return {
      kind: "ok" as const,
      contact,
      linkedAccountCount: accountIds.length,
    };
  });

  switch (outcome.kind) {
    case "not_activated":
      return NextResponse.json(
        { error: "CRM is not fully activated for this tenant" },
        { status: 409 }
      );
    case "invalid":
      return NextResponse.json(
        { error: "Validation failed", fieldErrors: outcome.fieldErrors },
        { status: 422 }
      );
    case "invalid_account":
      return NextResponse.json(
        {
          error: "One or more selected accounts were not found",
          missing: outcome.missing,
        },
        { status: 422 }
      );
    case "ok":
      return NextResponse.json(
        {
          record: serializeRecord(outcome.contact),
          linkedAccountCount: outcome.linkedAccountCount,
        },
        { status: 201 }
      );
  }
}
