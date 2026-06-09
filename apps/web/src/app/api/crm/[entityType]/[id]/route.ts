import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { records, withTenant } from "@adserve/database";
import { resolveCrmEntitySlug } from "@adserve/crm";
import {
  coerceFieldValue,
  getEntityTypeBySlug,
  listFieldDefinitions,
} from "@adserve/module-framework";
import {
  apiRequirePermission,
  getTenantContextOrNull,
  type TenantContext,
} from "@/lib/permissions";
import { loadRecordWithRelationships } from "@/lib/crm/relationships";
import { serializeRecord } from "@/lib/crm/serialize";
import { writeAuditLog } from "@/lib/crm/audit";
import {
  applyContactAccount,
  applyContactReportsTo,
  applyRelatedAccounts,
  getPrimaryAccountId,
  inheritAccountAddress,
  ContactAccountAbort,
  type RelatedAccountEntry,
} from "@/lib/crm/contact-account";

type Params = { params: Promise<{ entityType: string; id: string }> };

/**
 * Resolve the tenant context without an up-front permission check, so the
 * caller can apply a permission-OR-ownership rule. 401 if not signed in,
 * 403 if not a tenant user.
 */
async function resolveCtx(): Promise<
  { ctx: TenantContext; error: null } | { ctx: null; error: NextResponse }
> {
  const { userId } = await auth();
  if (!userId) {
    return {
      ctx: null,
      error: NextResponse.json({ error: "Unauthenticated" }, { status: 401 }),
    };
  }
  const ctx = await getTenantContextOrNull();
  if (!ctx) {
    return {
      ctx: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ctx, error: null };
}

/**
 * Permission-or-owner gate for mutations. A user may act if they hold the
 * permission, OR they own the record. Null `ownedBy` never grants access
 * via ownership — it falls back to the strict permission check.
 */
function canMutate(
  ctx: TenantContext,
  permissionKey: string,
  ownedBy: string | null
): boolean {
  if (ctx.permissions.has(permissionKey)) return true;
  return ownedBy !== null && ownedBy === ctx.user.id;
}

/** GET /api/crm/[entityType]/[id] — single record with relationships expanded. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { entityType: segment, id } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const guard = await apiRequirePermission(`${slug}.read`);
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  const result = await withTenant(tenant.id, async (tx) => {
    const entity = await getEntityTypeBySlug(tx, { tenantId: tenant.id, slug });
    if (!entity) return null;
    return loadRecordWithRelationships(tx, {
      tenantId: tenant.id,
      entityTypeId: entity.id,
      recordId: id,
    });
  });

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}

/** PATCH /api/crm/[entityType]/[id] — partial update of a record's data. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { entityType: segment, id } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const guard = await resolveCtx();
  if (guard.error) return guard.error;
  const { ctx } = guard;
  const { tenant, user } = ctx;

  let body: {
    data?: Record<string, unknown>;
    account?: { accountId?: string; newAccountName?: string } | null;
    relatedAccounts?: RelatedAccountEntry[];
    reportsTo?: { contactId?: string } | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const input = body.data ?? {};
  // The `account` (primary) and `relatedAccounts` relationships route separately
  // from records.data (same contract as create). Presence of the key is the
  // signal to apply (account: null clears; relatedAccounts: [] removes all);
  // absence leaves existing links untouched (partial update). Contacts only.
  const accountProvided = slug === "contact" && "account" in body;
  const relatedProvided = slug === "contact" && "relatedAccounts" in body;
  const reportsToProvided = slug === "contact" && "reportsTo" in body;
  const desiredRelated: RelatedAccountEntry[] = Array.isArray(
    body.relatedAccounts
  )
    ? body.relatedAccounts
    : [];

  let outcome;
  try {
    outcome = await withTenant(tenant.id, async (tx) => {
    const entity = await getEntityTypeBySlug(tx, { tenantId: tenant.id, slug });
    if (!entity) return { kind: "not_found" as const };

    const [existing] = await tx
      .select()
      .from(records)
      .where(
        and(
          eq(records.id, id),
          eq(records.tenantId, tenant.id),
          eq(records.entityTypeId, entity.id)
        )
      );
    if (!existing) return { kind: "not_found" as const };

    // AC 24: a converted lead is server-side read-only — reject edits for
    // EVERYONE (before the permission/ownership gate). Precise: only the lead
    // entity type, only when its status is "converted"; other entity types and
    // non-converted records are unaffected.
    if (
      slug === "lead" &&
      ((existing.data as Record<string, unknown>) ?? {}).status === "converted"
    ) {
      return { kind: "converted" as const };
    }

    if (!canMutate(ctx, `${slug}.update`, existing.ownedBy ?? null)) {
      return { kind: "forbidden" as const };
    }

    const fields = await listFieldDefinitions(tx, {
      tenantId: tenant.id,
      entityTypeId: entity.id,
    });
    const before = (existing.data as Record<string, unknown>) ?? {};
    const merged: Record<string, unknown> = { ...before };
    const fieldErrors: Record<string, string> = {};

    for (const field of fields) {
      // Relationship fields (e.g. `account`) live in record_relationships, not
      // records.data — applied below via accountProvided. Never coerce/store.
      if (field.fieldType === "relationship") continue;
      if (!(field.slug in input)) continue; // partial update
      const result = coerceFieldValue(field, input[field.slug]);
      if (!result.ok) {
        fieldErrors[field.slug] = result.error.message;
      } else if (result.value === null) {
        delete merged[field.slug];
      } else {
        merged[field.slug] = result.value;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { kind: "invalid" as const, fieldErrors };
    }

    // Apply the account relationships (primary first so related can be filtered
    // against it) BEFORE the data write. On failure the helpers' result is
    // thrown as ContactAccountAbort → the whole tx rolls back (nothing
    // persisted); on success everything commits atomically with the data write.
    let primaryAccountId: string | null = null;
    if (accountProvided) {
      const acc = body.account ?? {};
      const pr = await applyContactAccount(tx, {
        tenantId: tenant.id,
        userId: user.id,
        contactId: id,
        selection: {
          accountId: acc?.accountId ?? null,
          newAccountName: acc?.newAccountName ?? null,
        },
      });
      if (pr.kind !== "ok") throw new ContactAccountAbort(pr);
      primaryAccountId = pr.accountId;
    }

    if (relatedProvided) {
      // Filter related against the primary — the one being set this PATCH, or
      // the contact's current primary when primary isn't part of this request.
      const primaryForFilter = accountProvided
        ? primaryAccountId
        : await getPrimaryAccountId(tx, { tenantId: tenant.id, contactId: id });
      const rr = await applyRelatedAccounts(tx, {
        tenantId: tenant.id,
        userId: user.id,
        contactId: id,
        desired: desiredRelated,
        primaryAccountId: primaryForFilter,
      });
      if (rr.kind !== "ok") throw new ContactAccountAbort(rr);
    }

    if (reportsToProvided) {
      const mr = await applyContactReportsTo(tx, {
        tenantId: tenant.id,
        userId: user.id,
        contactId: id,
        managerContactId: body.reportsTo?.contactId ?? null,
      });
      if (mr.kind !== "ok") throw new ContactAccountAbort(mr);
    }

    // "Same as Site account address" → copy the primary account's address into
    // the contact's site-address fields (the just-set primary, else current).
    if (slug === "contact" && merged.sameAsAccountAddress === true) {
      const primaryId = accountProvided
        ? primaryAccountId
        : await getPrimaryAccountId(tx, { tenantId: tenant.id, contactId: id });
      if (primaryId) {
        Object.assign(
          merged,
          await inheritAccountAddress(tx, {
            tenantId: tenant.id,
            accountId: primaryId,
          })
        );
      }
    }

    const [row] = await tx
      .update(records)
      .set({ data: merged, updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(records.id, id), eq(records.tenantId, tenant.id)))
      .returning();

    await writeAuditLog(tx, {
      tenantId: tenant.id,
      userId: user.id,
      action: "update",
      resourceType: slug,
      resourceId: id,
      changes: { before, after: merged },
    });

    return { kind: "ok" as const, row };
    });
  } catch (e) {
    if (e instanceof ContactAccountAbort) return mapAbort(e);
    throw e;
  }

  if (outcome.kind === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (outcome.kind === "converted") {
    return NextResponse.json(
      { error: "Lead is converted and read-only" },
      { status: 409 }
    );
  }
  if (outcome.kind === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (outcome.kind === "invalid") {
    return NextResponse.json(
      { error: "Validation failed", fieldErrors: outcome.fieldErrors },
      { status: 422 }
    );
  }
  return NextResponse.json({ record: serializeRecord(outcome.row) });
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
  if (o.kind === "invalid_contact") {
    return NextResponse.json(
      { error: "Selected contact was not found", contactId: o.contactId },
      { status: 422 }
    );
  }
  if (o.kind === "self_reference") {
    return NextResponse.json(
      { error: "A contact cannot report to itself" },
      { status: 422 }
    );
  }
  return NextResponse.json({ error: "Unexpected" }, { status: 500 });
}

/** DELETE /api/crm/[entityType]/[id] — soft delete (isArchived = true). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { entityType: segment, id } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const guard = await resolveCtx();
  if (guard.error) return guard.error;
  const { ctx } = guard;
  const { tenant, user } = ctx;

  const outcome = await withTenant(tenant.id, async (tx) => {
    const entity = await getEntityTypeBySlug(tx, { tenantId: tenant.id, slug });
    if (!entity) return { kind: "not_found" as const };

    const [existing] = await tx
      .select()
      .from(records)
      .where(
        and(
          eq(records.id, id),
          eq(records.tenantId, tenant.id),
          eq(records.entityTypeId, entity.id)
        )
      );
    if (!existing) return { kind: "not_found" as const };

    if (!canMutate(ctx, `${slug}.delete`, existing.ownedBy ?? null)) {
      return { kind: "forbidden" as const };
    }

    const [row] = await tx
      .update(records)
      .set({ isArchived: true, updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(records.id, id), eq(records.tenantId, tenant.id)))
      .returning();

    await writeAuditLog(tx, {
      tenantId: tenant.id,
      userId: user.id,
      action: "archive",
      resourceType: slug,
      resourceId: id,
      changes: { before: { isArchived: false }, after: { isArchived: true } },
    });

    return { kind: "ok" as const, row };
  });

  if (outcome.kind === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (outcome.kind === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ record: serializeRecord(outcome.row) });
}
