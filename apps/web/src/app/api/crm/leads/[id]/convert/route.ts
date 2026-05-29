import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
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

type Params = { params: Promise<{ id: string }> };

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * POST /api/crm/leads/[id]/convert — single transaction: create an
 * account + contact + opportunity from the lead, link them via
 * record_relationships, and set the lead's status to "converted".
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const guard = await apiRequirePermission("lead.convert");
  if (guard.error) return guard.error;
  const { tenant, user } = guard.ctx;

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

    const stages =
      (opportunityEntity.settings as { pipelineStages?: { slug: string }[] })
        ?.pipelineStages ?? [];
    const stage = stages[0]?.slug ?? "qualification";

    const ownedBy = lead.ownedBy ?? user.id;
    const stamp = { createdBy: user.id, updatedBy: user.id, ownedBy };

    const [account] = await tx
      .insert(records)
      .values({
        tenantId: tenant.id,
        entityTypeId: accountEntity.id,
        data: { name: accountName, status: "prospect" },
        ...stamp,
      })
      .returning();

    const contactData: Record<string, unknown> = { status: "active" };
    if (firstName) contactData.firstName = firstName;
    if (lastName) contactData.lastName = lastName;
    if (str(leadData.email)) contactData.email = leadData.email;
    if (str(leadData.phone)) contactData.phone = leadData.phone;

    const [contact] = await tx
      .insert(records)
      .values({
        tenantId: tenant.id,
        entityTypeId: contactEntity.id,
        data: contactData,
        ...stamp,
      })
      .returning();

    const opportunityData: Record<string, unknown> = {
      name: `${accountName} opportunity`,
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

    // Link via record_relationships using the activated schema relationships.
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
      await tx.insert(recordRelationships).values(linkValues);
    }

    // Mark the lead converted.
    const newLeadData = { ...leadData, status: "converted" };
    await tx
      .update(records)
      .set({ data: newLeadData, updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(records.id, id), eq(records.tenantId, tenant.id)));

    // Audit: one create row per produced entity + one update for the lead.
    for (const [resourceType, row] of [
      ["account", account],
      ["contact", contact],
      ["opportunity", opportunity],
    ] as const) {
      await writeAuditLog(tx, {
        tenantId: tenant.id,
        userId: user.id,
        action: "create",
        resourceType,
        resourceId: row.id,
        changes: { after: row.data },
      });
    }
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
