import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { records, withTenant } from "@adserve/database";
import {
  coerceFieldValue,
  getEntityTypeBySlug,
  listFieldDefinitions,
} from "@adserve/module-framework";
import {
  CAMPAIGN_BELONGS_TO_ACCOUNT,
  CAMPAIGN_HAS_PRIMARY_CONTACT,
} from "@adserve/crm";
import { apiRequirePermission } from "@/lib/permissions";
import { serializeRecord } from "@/lib/crm/serialize";
import { writeAuditLog } from "@/lib/crm/audit";
import { findAccountByName } from "@/lib/crm/account-name";
import { createRecordLink, resolveRelationshipByName } from "@/lib/crm/link-records";

/**
 * POST /api/crm/campaigns/with-account — combined campaign-create endpoint.
 *
 * A campaign REQUIRES exactly one owning Account (campaign_belongs_to_account,
 * M2O), so the record + its account link are written in ONE `withTenant` tx
 * (all-or-nothing). Mirrors the lead-convert create+link pattern and reuses the
 * shared account-dedup (findAccountByName) and link writer (createRecordLink).
 *
 * Body: { data, accountId? | newAccountName?, primaryContactId? }
 *   - accountId — link an existing account (REQUIRED unless newAccountName).
 *   - newAccountName — create a new account (rejected 409 if the name exists).
 *   - primaryContactId — optional primary contact (campaign_has_primary_contact,
 *     M2M, metadata.isPrimary).
 */
export async function POST(req: NextRequest) {
  const guard = await apiRequirePermission("campaign.create");
  if (guard.error) return guard.error;
  const { tenant, user } = guard.ctx;

  let body: {
    data?: Record<string, unknown>;
    accountId?: unknown;
    newAccountName?: unknown;
    primaryContactId?: unknown;
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
  const primaryContactId =
    typeof body.primaryContactId === "string" && body.primaryContactId.trim() !== ""
      ? body.primaryContactId
      : null;

  if (newAccountName && accountId) {
    return NextResponse.json(
      { error: "Provide either newAccountName or an existing account, not both" },
      { status: 400 }
    );
  }
  if (!newAccountName && !accountId) {
    return NextResponse.json(
      { error: "A campaign requires an account", fieldErrors: { account: "Required" } },
      { status: 422 }
    );
  }

  const outcome = await withTenant(tenant.id, async (tx) => {
    const [campaignEntity, accountEntity] = await Promise.all([
      getEntityTypeBySlug(tx, { tenantId: tenant.id, slug: "campaign" }),
      getEntityTypeBySlug(tx, { tenantId: tenant.id, slug: "account" }),
    ]);
    if (!campaignEntity || !accountEntity) {
      return { kind: "not_activated" as const };
    }

    // Coerce the campaign's non-relationship fields (relationship fields live
    // in record_relationships, not records.data).
    const fields = await listFieldDefinitions(tx, {
      tenantId: tenant.id,
      entityTypeId: campaignEntity.id,
    });
    const data: Record<string, unknown> = {};
    const fieldErrors: Record<string, string> = {};
    for (const field of fields) {
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

    // Resolve the owning account (existing or create-new with dedup).
    let account: typeof records.$inferSelect | undefined;
    if (accountId) {
      [account] = await tx
        .select()
        .from(records)
        .where(
          and(
            eq(records.id, accountId),
            eq(records.tenantId, tenant.id),
            eq(records.entityTypeId, accountEntity.id)
          )
        );
      if (!account) return { kind: "invalid_account" as const, accountId };
    } else if (newAccountName) {
      const dup = await findAccountByName(tx, {
        tenantId: tenant.id,
        accountEntityTypeId: accountEntity.id,
        name: newAccountName,
      });
      if (dup) {
        return {
          kind: "duplicate_account" as const,
          existing: { id: dup.id, name: (dup.data as { name?: string }).name ?? newAccountName },
        };
      }
      [account] = await tx
        .insert(records)
        .values({
          tenantId: tenant.id,
          entityTypeId: accountEntity.id,
          data: { name: newAccountName, status: "Prospect" },
          createdBy: user.id,
          updatedBy: user.id,
          ownedBy: user.id,
        })
        .returning();
      await writeAuditLog(tx, {
        tenantId: tenant.id,
        userId: user.id,
        action: "create",
        resourceType: "account",
        resourceId: account.id,
        changes: { after: account.data },
      });
    }

    // Validate the optional primary contact under RLS before linking.
    if (primaryContactId) {
      const [contact] = await tx
        .select({ id: records.id })
        .from(records)
        .where(
          and(
            eq(records.id, primaryContactId),
            eq(records.tenantId, tenant.id)
          )
        );
      if (!contact) {
        return { kind: "invalid_contact" as const, contactId: primaryContactId };
      }
    }

    const [campaign] = await tx
      .insert(records)
      .values({
        tenantId: tenant.id,
        entityTypeId: campaignEntity.id,
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
      resourceType: "campaign",
      resourceId: campaign.id,
      changes: { after: campaign.data },
    });

    // Link campaign → account (M2O, required).
    const accountRel = await resolveRelationshipByName(
      tx,
      tenant.id,
      CAMPAIGN_BELONGS_TO_ACCOUNT.name
    );
    if (!accountRel) return { kind: "not_activated" as const };
    await createRecordLink(tx, {
      tenantId: tenant.id,
      userId: user.id,
      relationship: accountRel,
      sourceRecordId: campaign.id,
      targetRecordId: account!.id,
    });

    // Optional primary contact (M2M, isPrimary).
    if (primaryContactId) {
      const contactRel = await resolveRelationshipByName(
        tx,
        tenant.id,
        CAMPAIGN_HAS_PRIMARY_CONTACT.name
      );
      if (contactRel) {
        await createRecordLink(tx, {
          tenantId: tenant.id,
          userId: user.id,
          relationship: contactRel,
          sourceRecordId: campaign.id,
          targetRecordId: primaryContactId,
          isPrimary: true,
        });
      }
    }

    return { kind: "ok" as const, campaign, accountId: account!.id };
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
        { error: "Selected account was not found", accountId: outcome.accountId },
        { status: 422 }
      );
    case "invalid_contact":
      return NextResponse.json(
        { error: "Selected contact was not found", contactId: outcome.contactId },
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
        { record: serializeRecord(outcome.campaign), accountId: outcome.accountId },
        { status: 201 }
      );
  }
}
