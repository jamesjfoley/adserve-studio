import { NextRequest, NextResponse } from "next/server";
import { and, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import {
  records,
  recordRelationships,
  schemaRelationships,
  withTenant,
} from "@adserve/database";
import {
  CONTACT_BELONGS_TO_ACCOUNT,
  OPPORTUNITY_BELONGS_TO_ACCOUNT,
  OPPORTUNITY_HAS_PRIMARY_CONTACT,
} from "@adserve/crm";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { apiRequirePermission } from "@/lib/permissions";
import { serializeRecord } from "@/lib/crm/serialize";
import { writeAuditLog } from "@/lib/crm/audit";
import { findAccountByName } from "@/lib/crm/account-name";

type Params = { params: Promise<{ id: string }> };

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Confirm flag from `?confirm=1` query or a `{ confirm: true }` JSON body. */
async function readConfirm(req: NextRequest): Promise<boolean> {
  const q = new URL(req.url).searchParams.get("confirm");
  if (q === "1" || q === "true") return true;
  try {
    const body = (await req.json()) as { confirm?: unknown } | null;
    return body?.confirm === true;
  } catch {
    // No / non-JSON body — treat as unconfirmed.
    return false;
  }
}

/**
 * POST /api/crm/leads/[id]/convert — single atomic transaction.
 *
 * Default (unconfirmed): if the computed account name already matches a
 * non-archived account (AC 21), or a same-named contact already exists in that
 * account (AC 22), return 409 { warning, existing } and write NOTHING (the
 * duplicate checks run before the first insert).
 *
 * Confirmed (`?confirm=1` / `{ confirm: true }`, AC 23): link to the matched
 * account/contact instead of duplicating, create only what is missing (always
 * the opportunity), write the lead's `data.convertedTo` back-links, and emit
 * `link` audit rows for matched entities + `create` rows for new ones — all in
 * the same transaction. The opportunity name is `<Account> <YYYY-MM-DD>` (AC 20).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;

  const guard = await apiRequirePermission("lead.convert");
  if (guard.error) return guard.error;
  const { tenant, user } = guard.ctx;

  const confirm = await readConfirm(req);

  const outcome = await withTenant(tenant.id, async (tx) => {
    const [leadEntity, accountEntity, contactEntity, opportunityEntity] =
      await Promise.all([
        getEntityTypeBySlug(tx, { tenantId: tenant.id, slug: "lead" }),
        getEntityTypeBySlug(tx, { tenantId: tenant.id, slug: "account" }),
        getEntityTypeBySlug(tx, { tenantId: tenant.id, slug: "contact" }),
        getEntityTypeBySlug(tx, { tenantId: tenant.id, slug: "opportunity" }),
      ]);
    if (!leadEntity || !accountEntity || !contactEntity || !opportunityEntity) {
      return { kind: "not_activated" as const };
    }

    const [lead] = await tx
      .select()
      .from(records)
      .where(
        and(
          eq(records.id, id),
          eq(records.tenantId, tenant.id),
          eq(records.entityTypeId, leadEntity.id)
        )
      );
    if (!lead) return { kind: "not_found" as const };

    const leadData = (lead.data as Record<string, unknown>) ?? {};
    if (leadData.status === "converted") {
      return { kind: "already_converted" as const };
    }

    const firstName = str(leadData.firstName);
    const lastName = str(leadData.lastName);
    const personName = [firstName, lastName].filter(Boolean).join(" ").trim();
    const accountName =
      str(leadData.company) || personName || "Untitled account";

    // Resolve the seeded relationship ids up front (needed for the contact
    // duplicate lookup AND the links below).
    const relNames = [
      CONTACT_BELONGS_TO_ACCOUNT.name,
      OPPORTUNITY_BELONGS_TO_ACCOUNT.name,
      OPPORTUNITY_HAS_PRIMARY_CONTACT.name,
    ];
    const relRows = await tx
      .select({ id: schemaRelationships.id, name: schemaRelationships.name })
      .from(schemaRelationships)
      .where(
        and(
          eq(schemaRelationships.tenantId, tenant.id),
          inArray(schemaRelationships.name, relNames)
        )
      );
    const relIdByName = new Map(relRows.map((r) => [r.name, r.id]));
    const contactAccountRelId = relIdByName.get(CONTACT_BELONGS_TO_ACCOUNT.name);

    // --- Duplicate checks (tenant-scoped via withTenant + RLS, non-archived).
    //     These are READ-ONLY and sit BEFORE any insert, so an early warn
    //     return commits nothing. ---
    // Account duplicate check (AC 21) — shared normalised-name lookup, the same
    // helper the contact-create create-new branch uses (lib/crm/account-name).
    const accountMatch =
      (await findAccountByName(tx, {
        tenantId: tenant.id,
        accountEntityTypeId: accountEntity.id,
        name: accountName,
      })) ?? undefined;

    let contactMatch: typeof records.$inferSelect | undefined;
    if (accountMatch && personName && contactAccountRelId) {
      // A contact "of the same name" linked to the matched account.
      [contactMatch] = await tx
        .select(getTableColumns(records))
        .from(records)
        .innerJoin(
          recordRelationships,
          and(
            eq(recordRelationships.sourceRecordId, records.id),
            eq(recordRelationships.relationshipId, contactAccountRelId),
            eq(recordRelationships.targetRecordId, accountMatch.id)
          )
        )
        .where(
          and(
            eq(records.tenantId, tenant.id),
            eq(records.entityTypeId, contactEntity.id),
            eq(records.isArchived, false),
            // Case/whitespace-insensitive match (lower(trim(...)) both sides).
            sql`lower(btrim(concat_ws(' ', ${records.data}->>'firstName', ${records.data}->>'lastName'))) = lower(btrim(${personName}))`
          )
        )
        .limit(1);
    }

    // --- Warn path: unconfirmed + a match → 409 before any write. The more
    //     specific contact match takes precedence over the account match. ---
    if (!confirm) {
      if (contactMatch) {
        return {
          kind: "contact_exists" as const,
          existing: { accountId: accountMatch!.id, contactId: contactMatch.id },
        };
      }
      if (accountMatch) {
        return {
          kind: "account_exists" as const,
          existing: { accountId: accountMatch.id },
        };
      }
    }

    // --- Proceed: link-to-existing for matches, create the rest. ---
    const stages =
      (opportunityEntity.settings as { pipelineStages?: { slug: string }[] })
        ?.pipelineStages ?? [];
    const stage = stages[0]?.slug ?? "qualification";

    const ownedBy = lead.ownedBy ?? user.id;
    const stamp = { createdBy: user.id, updatedBy: user.id, ownedBy };

    const accountCreated = !accountMatch;
    const account =
      accountMatch ??
      (
        await tx
          .insert(records)
          .values({
            tenantId: tenant.id,
            entityTypeId: accountEntity.id,
            data: { name: accountName, status: "prospect" },
            ...stamp,
          })
          .returning()
      )[0];

    const contactCreated = !contactMatch;
    let contact = contactMatch;
    if (!contact) {
      const contactData: Record<string, unknown> = { status: "active" };
      if (firstName) contactData.firstName = firstName;
      if (lastName) contactData.lastName = lastName;
      if (str(leadData.email)) contactData.email = leadData.email;
      if (str(leadData.phone)) contactData.phone = leadData.phone;
      [contact] = await tx
        .insert(records)
        .values({
          tenantId: tenant.id,
          entityTypeId: contactEntity.id,
          data: contactData,
          ...stamp,
        })
        .returning();
    }

    // Opportunity is always created. Name: `<Account> <YYYY-MM-DD>` (AC 20).
    const conversionDate = new Date().toISOString().slice(0, 10);
    const opportunityData: Record<string, unknown> = {
      name: `${accountName} ${conversionDate}`,
      stage,
    };
    if (leadData.estimatedValue) {
      opportunityData.amount = leadData.estimatedValue;
    }
    const [opportunity] = await tx
      .insert(records)
      .values({
        tenantId: tenant.id,
        entityTypeId: opportunityEntity.id,
        data: opportunityData,
        ...stamp,
      })
      .returning();

    // Link via record_relationships. A matched contact↔account link already
    // exists, so insertion is idempotent (onConflictDoNothing on the unique
    // (relationship, source, target) index).
    const links: Array<{ name: string; source: string; target: string }> = [
      {
        name: CONTACT_BELONGS_TO_ACCOUNT.name,
        source: contact.id,
        target: account.id,
      },
      {
        name: OPPORTUNITY_BELONGS_TO_ACCOUNT.name,
        source: opportunity.id,
        target: account.id,
      },
      {
        name: OPPORTUNITY_HAS_PRIMARY_CONTACT.name,
        source: opportunity.id,
        target: contact.id,
      },
    ];
    const linkValues = links
      .map((l) => ({ relationshipId: relIdByName.get(l.name), ...l }))
      .filter((l) => l.relationshipId)
      .map((l) => ({
        tenantId: tenant.id,
        relationshipId: l.relationshipId as string,
        sourceRecordId: l.source,
        targetRecordId: l.target,
      }));
    if (linkValues.length > 0) {
      await tx.insert(recordRelationships).values(linkValues).onConflictDoNothing();
    }

    // Mark the lead converted + write the back-links (ordinary records.data
    // JSONB write — no new relationship type, no schema change).
    const convertedTo = {
      accountId: account.id,
      contactId: contact.id,
      opportunityId: opportunity.id,
    };
    const newLeadData = { ...leadData, status: "converted", convertedTo };
    await tx
      .update(records)
      .set({ data: newLeadData, updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(records.id, id), eq(records.tenantId, tenant.id)));

    // Audit: `create` per newly-created entity, `link` per matched-existing
    // entity, `update` for the lead.
    await writeAuditLog(tx, {
      tenantId: tenant.id,
      userId: user.id,
      action: accountCreated ? "create" : "link",
      resourceType: "account",
      resourceId: account.id,
      changes: accountCreated
        ? { after: account.data }
        : { linkedExisting: true },
    });
    await writeAuditLog(tx, {
      tenantId: tenant.id,
      userId: user.id,
      action: contactCreated ? "create" : "link",
      resourceType: "contact",
      resourceId: contact.id,
      changes: contactCreated
        ? { after: contact.data }
        : { linkedExisting: true },
    });
    await writeAuditLog(tx, {
      tenantId: tenant.id,
      userId: user.id,
      action: "create",
      resourceType: "opportunity",
      resourceId: opportunity.id,
      changes: { after: opportunity.data },
    });
    await writeAuditLog(tx, {
      tenantId: tenant.id,
      userId: user.id,
      action: "update",
      resourceType: "lead",
      resourceId: id,
      changes: {
        before: { status: leadData.status ?? null },
        after: { status: "converted" },
      },
    });

    return { kind: "ok" as const, account, contact, opportunity };
  });

  switch (outcome.kind) {
    case "not_activated":
      return NextResponse.json(
        { error: "CRM is not fully activated for this tenant" },
        { status: 409 }
      );
    case "not_found":
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    case "already_converted":
      return NextResponse.json(
        { error: "Lead is already converted" },
        { status: 409 }
      );
    case "account_exists":
      return NextResponse.json(
        { warning: "account_exists", existing: outcome.existing },
        { status: 409 }
      );
    case "contact_exists":
      return NextResponse.json(
        { warning: "contact_exists", existing: outcome.existing },
        { status: 409 }
      );
    case "ok":
      return NextResponse.json(
        {
          account: serializeRecord(outcome.account),
          contact: serializeRecord(outcome.contact),
          opportunity: serializeRecord(outcome.opportunity),
        },
        { status: 201 }
      );
  }
}
