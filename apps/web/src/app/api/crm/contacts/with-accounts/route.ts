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
import { findAccountByName } from "@/lib/crm/account-name";
import {
  createRecordLink,
  resolveRelationshipByName,
} from "@/lib/crm/link-records";

/**
 * POST /api/crm/contacts/with-accounts — combined contact-create endpoint.
 *
 * Creates a contact AND links it to its account via the
 * `contact_belongs_to_account` relationship inside ONE `withTenant`
 * transaction (all-or-nothing — never a half-created contact when a link
 * fails). Runs under `contact.create`; the create-time owner is the acting
 * user.
 *
 * Account selection (the prototype enforces ONE account per contact in the UX +
 * here; the data model stays many_to_many — see docs/prototypes/crm/SPEC.md):
 *   - `accountId`      — link to a single existing account, OR
 *   - `newAccountName` — create a NEW account (name validated unique via the
 *                        shared `lower(btrim())` helper) then link, in the same
 *                        tx, OR
 *   - `accountIds`     — legacy multi-link (kept for back-compat), OR
 *   - none             — an unlinked contact.
 * `newAccountName` is mutually exclusive with `accountId`/`accountIds`.
 *
 * Body: {
 *   data: Record<string, unknown>,
 *   accountId?: string,
 *   newAccountName?: string,
 *   accountIds?: string[],
 * }
 *
 * Every existing accountId is resolved under the caller's `withTenant` context:
 * a cross-tenant id returns zero rows under RLS and is rejected (whole tx
 * aborts → no contact, no links).
 */
export async function POST(req: NextRequest) {
  const guard = await apiRequirePermission("contact.create");
  if (guard.error) return guard.error;
  const { tenant, user } = guard.ctx;

  let body: {
    data?: Record<string, unknown>;
    accountId?: unknown;
    newAccountName?: unknown;
    accountIds?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const input = body.data ?? {};

  // create-new branch: a non-empty trimmed name.
  const newAccountName =
    typeof body.newAccountName === "string" && body.newAccountName.trim() !== ""
      ? body.newAccountName.trim()
      : null;

  // Existing-account ids: single `accountId` plus the legacy `accountIds` array,
  // de-duplicated, non-empty strings only.
  const rawIds = [
    ...(typeof body.accountId === "string" ? [body.accountId] : []),
    ...(Array.isArray(body.accountIds) ? body.accountIds : []),
  ];
  const accountIds = Array.from(
    new Set(
      rawIds.filter((v): v is string => typeof v === "string" && v.trim() !== "")
    )
  );

  // create-new and link-existing are mutually exclusive.
  if (newAccountName && accountIds.length > 0) {
    return NextResponse.json(
      { error: "Provide either newAccountName or an existing account, not both" },
      { status: 400 }
    );
  }

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
      // Relationship fields (e.g. `account`) live in record_relationships, not
      // records.data — they arrive via accountId/newAccountName and are linked
      // below. Never coerce/store them as data.
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

    // Resolve the contact↔account relationship once if any linking is requested.
    let rel: Awaited<ReturnType<typeof resolveRelationshipByName>> = null;
    const needsRelationship = newAccountName != null || accountIds.length > 0;
    if (needsRelationship) {
      rel = await resolveRelationshipByName(
        tx,
        tenant.id,
        CONTACT_BELONGS_TO_ACCOUNT.name
      );
      if (!rel) return { kind: "not_activated" as const };
    }

    // The account ids to link the contact to (resolved below).
    let linkTargetIds: string[] = [];
    let createdAccount: typeof records.$inferSelect | null = null;

    if (newAccountName != null && rel) {
      // Uniqueness (shared helper, same normalisation as lead-convert AC 21).
      const dup = await findAccountByName(tx, {
        tenantId: tenant.id,
        accountEntityTypeId: rel.targetEntityTypeId,
        name: newAccountName,
      });
      if (dup) {
        return {
          kind: "duplicate_account" as const,
          existing: {
            id: dup.id,
            name: (dup.data as { name?: string }).name ?? newAccountName,
          },
        };
      }
      // Create the account in the same tx (mirrors the lead-convert insert).
      const [account] = await tx
        .insert(records)
        .values({
          tenantId: tenant.id,
          entityTypeId: rel.targetEntityTypeId,
          data: { name: newAccountName, status: "prospect" },
          createdBy: user.id,
          updatedBy: user.id,
          ownedBy: user.id,
        })
        .returning();
      createdAccount = account;
      linkTargetIds = [account.id];

      await writeAuditLog(tx, {
        tenantId: tenant.id,
        userId: user.id,
        action: "create",
        resourceType: "account",
        resourceId: account.id,
        changes: { after: account.data },
      });
    } else if (accountIds.length > 0 && rel) {
      // Resolve existing accounts under the caller's tenant context. A
      // cross-tenant id yields zero rows under RLS, so the resolved set is
      // smaller than the requested set → reject (no partial linking).
      const accountRows = await tx
        .select({ id: records.id })
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
      linkTargetIds = accountIds;
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

    // Link the contact (SOURCE side of contact_belongs_to_account) to its
    // account(s). Same tx → atomic with the create. createRecordLink applies
    // many_to_one "replace" semantics when the relationship is many_to_one; at
    // create there is at most one link per call so single-account is trivially
    // held (the prototype keeps the relationship many_to_many in the registry).
    if (rel) {
      for (const accountId of linkTargetIds) {
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
      createdAccount,
      linkedAccountCount: linkTargetIds.length,
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
    case "duplicate_account":
      return NextResponse.json(
        {
          error: `An account named "${outcome.existing.name}" already exists`,
          existing: outcome.existing,
        },
        { status: 409 }
      );
    case "ok":
      return NextResponse.json(
        {
          record: serializeRecord(outcome.contact),
          createdAccount: outcome.createdAccount
            ? serializeRecord(outcome.createdAccount)
            : null,
          linkedAccountCount: outcome.linkedAccountCount,
        },
        { status: 201 }
      );
  }
}
