import { NextRequest, NextResponse } from "next/server";
import { records, withTenant } from "@adserve/database";
import {
  coerceFieldValue,
  getEntityTypeBySlug,
  listFieldDefinitions,
} from "@adserve/module-framework";
import { apiRequirePermission } from "@/lib/permissions";
import { serializeRecord } from "@/lib/crm/serialize";
import { writeAuditLog } from "@/lib/crm/audit";
import {
  applyContactAccount,
  applyRelatedAccounts,
  ContactAccountAbort,
  type RelatedAccountEntry,
} from "@/lib/crm/contact-account";

/**
 * POST /api/crm/contacts/with-accounts — combined contact-create endpoint.
 *
 * Creates a contact and links its accounts in ONE `withTenant` transaction
 * (all-or-nothing — a thrown `ContactAccountAbort` rolls back the whole tx):
 *   - `accountId` | `newAccountName` — the PRIMARY account (many_to_one). Both
 *     absent → no primary. The two are mutually exclusive.
 *   - `relatedAccounts` — a set of RELATED accounts (many_to_many), each an
 *     existing `{accountId}` or a new `{newAccountName}`. Filtered against the
 *     primary (no self-overlap).
 *
 * The legacy `accountIds[]` multi-primary field is REMOVED — multi-account
 * intent now routes to `relatedAccounts`, never to multiple primaries.
 *
 * Body: { data, accountId?, newAccountName?, relatedAccounts? }
 */
export async function POST(req: NextRequest) {
  const guard = await apiRequirePermission("contact.create");
  if (guard.error) return guard.error;
  const { tenant, user } = guard.ctx;

  let body: {
    data?: Record<string, unknown>;
    accountId?: unknown;
    newAccountName?: unknown;
    relatedAccounts?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const input = body.data ?? {};

  const newAccountName =
    typeof body.newAccountName === "string" && body.newAccountName.trim() !== ""
      ? body.newAccountName.trim()
      : null;
  const accountId =
    typeof body.accountId === "string" && body.accountId.trim() !== ""
      ? body.accountId
      : null;
  if (newAccountName && accountId) {
    return NextResponse.json(
      { error: "Provide either newAccountName or an existing account, not both" },
      { status: 400 }
    );
  }
  const hasPrimary = newAccountName != null || accountId != null;
  const relatedAccounts: RelatedAccountEntry[] = Array.isArray(
    body.relatedAccounts
  )
    ? (body.relatedAccounts as RelatedAccountEntry[])
    : [];

  let outcome:
    | {
        kind: "ok";
        contact: typeof records.$inferSelect;
        primaryAccountId: string | null;
        relatedCount: number;
      }
    | { kind: "not_activated" }
    | { kind: "invalid"; fieldErrors: Record<string, string> };

  try {
    outcome = await withTenant(tenant.id, async (tx) => {
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
        // Relationship fields live in record_relationships, not records.data.
        if (field.fieldType === "relationship") continue;
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

      // Primary first (so related can be filtered against it), then related.
      let primaryAccountId: string | null = null;
      if (hasPrimary) {
        const pr = await applyContactAccount(tx, {
          tenantId: tenant.id,
          userId: user.id,
          contactId: contact.id,
          selection: { accountId, newAccountName },
        });
        if (pr.kind !== "ok") throw new ContactAccountAbort(pr);
        primaryAccountId = pr.accountId;
      }

      let relatedCount = 0;
      if (relatedAccounts.length > 0) {
        const rr = await applyRelatedAccounts(tx, {
          tenantId: tenant.id,
          userId: user.id,
          contactId: contact.id,
          desired: relatedAccounts,
          primaryAccountId,
        });
        if (rr.kind !== "ok") throw new ContactAccountAbort(rr);
        relatedCount = rr.linkedAccountIds.length;
      }

      return { kind: "ok" as const, contact, primaryAccountId, relatedCount };
    });
  } catch (e) {
    if (e instanceof ContactAccountAbort) return mapAbort(e);
    throw e;
  }

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
    case "ok":
      return NextResponse.json(
        {
          record: serializeRecord(outcome.contact),
          primaryAccountId: outcome.primaryAccountId,
          relatedAccountCount: outcome.relatedCount,
        },
        { status: 201 }
      );
  }
}

/** Map a rolled-back contact-account apply failure to its HTTP response. */
function mapAbort(e: ContactAccountAbort): NextResponse {
  const o = e.outcome;
  if (o.kind === "not_activated") {
    return NextResponse.json(
      { error: "CRM is not fully activated for this tenant" },
      { status: 409 }
    );
  }
  if (o.kind === "invalid_account") {
    return NextResponse.json(
      { error: "An account was not found", accountId: o.accountId },
      { status: 422 }
    );
  }
  if (o.kind === "duplicate_account") {
    return NextResponse.json(
      {
        error: `An account named "${o.existing.name}" already exists`,
        existing: o.existing,
      },
      { status: 409 }
    );
  }
  // ok never reaches here.
  return NextResponse.json({ error: "Unexpected" }, { status: 500 });
}
