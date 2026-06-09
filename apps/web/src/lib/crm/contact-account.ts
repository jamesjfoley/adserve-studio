import { and, eq, inArray } from "drizzle-orm";
import { records, recordRelationships, type db } from "@adserve/database";
import {
  CONTACT_BELONGS_TO_ACCOUNT,
  CONTACT_RELATED_TO_ACCOUNT,
  CONTACT_REPORTS_TO_CONTACT,
} from "@adserve/crm";
import { findAccountByName } from "./account-name";
import { createRecordLink, resolveRelationshipByName } from "./link-records";
import { writeAuditLog } from "./audit";

/**
 * The single PRIMARY contact→account selection from a form submit: an existing
 * account id, a new account name to create, or neither (clear the link).
 */
export interface ContactAccountSelection {
  accountId?: string | null;
  newAccountName?: string | null;
}

export type ApplyContactAccountResult =
  | { kind: "ok"; accountId: string | null; createdAccountId: string | null }
  | { kind: "not_activated" }
  | { kind: "invalid_account"; accountId: string }
  | { kind: "duplicate_account"; existing: { id: string; name: string } };

/**
 * Apply a contact's PRIMARY account selection inside the caller's `withTenant`
 * tx (`contact_belongs_to_account`, now genuinely many_to_one):
 *
 *  - `newAccountName` → validate unique (`findAccountByName`), create, link.
 *  - `accountId` → validate it exists in this tenant, link.
 *  - neither → CLEAR (remove the existing primary link).
 *
 * Single-primary is enforced by `createRecordLink`'s many_to_one REPLACE branch
 * (the registry row is M2O after the flip — we pass the real relationship, no
 * override). Setting a primary also drops any RELATED link to that same account
 * (primary wins — the no-self-overlap rule). Returns an error kind WITHOUT
 * writing on duplicate/invalid/not-activated.
 */
export async function applyContactAccount(
  tx: typeof db,
  args: {
    tenantId: string;
    userId: string | null;
    contactId: string;
    selection: ContactAccountSelection;
  }
): Promise<ApplyContactAccountResult> {
  const { tenantId, userId, contactId, selection } = args;

  const newName =
    typeof selection.newAccountName === "string" &&
    selection.newAccountName.trim() !== ""
      ? selection.newAccountName.trim()
      : null;
  const accountId =
    typeof selection.accountId === "string" && selection.accountId.trim() !== ""
      ? selection.accountId
      : null;

  const rel = await resolveRelationshipByName(
    tx,
    tenantId,
    CONTACT_BELONGS_TO_ACCOUNT.name
  );
  if (!rel) return { kind: "not_activated" };

  // CLEAR — nothing selected → drop any existing primary link for this contact.
  if (!newName && !accountId) {
    const removed = await tx
      .delete(recordRelationships)
      .where(
        and(
          eq(recordRelationships.tenantId, tenantId),
          eq(recordRelationships.relationshipId, rel.id),
          eq(recordRelationships.sourceRecordId, contactId)
        )
      )
      .returning({ id: recordRelationships.id });
    if (removed.length > 0) {
      await writeAuditLog(tx, {
        tenantId,
        userId,
        action: "unlink",
        resourceType: "relationship",
        resourceId: contactId,
        changes: { relationshipName: rel.name, cleared: removed.length },
      });
    }
    return { kind: "ok", accountId: null, createdAccountId: null };
  }

  let targetId: string;
  let createdAccountId: string | null = null;

  if (newName) {
    const dup = await findAccountByName(tx, {
      tenantId,
      accountEntityTypeId: rel.targetEntityTypeId,
      name: newName,
    });
    if (dup) {
      return {
        kind: "duplicate_account",
        existing: {
          id: dup.id,
          name: (dup.data as { name?: string }).name ?? newName,
        },
      };
    }
    const [account] = await tx
      .insert(records)
      .values({
        tenantId,
        entityTypeId: rel.targetEntityTypeId,
        data: { name: newName, status: "prospect" },
        createdBy: userId,
        updatedBy: userId,
        ownedBy: userId,
      })
      .returning();
    targetId = account.id;
    createdAccountId = account.id;
    await writeAuditLog(tx, {
      tenantId,
      userId,
      action: "create",
      resourceType: "account",
      resourceId: account.id,
      changes: { after: account.data },
    });
  } else {
    const [acc] = await tx
      .select({ id: records.id })
      .from(records)
      .where(
        and(
          eq(records.tenantId, tenantId),
          eq(records.entityTypeId, rel.targetEntityTypeId),
          eq(records.id, accountId as string)
        )
      );
    if (!acc) return { kind: "invalid_account", accountId: accountId as string };
    targetId = acc.id;
  }

  // Single-primary: pass the real (M2O) relationship → REPLACE branch deletes
  // any prior primary link, then inserts this one.
  await createRecordLink(tx, {
    tenantId,
    userId,
    relationship: rel,
    sourceRecordId: contactId,
    targetRecordId: targetId,
  });

  // Self-overlap: primary wins — remove any RELATED link to the same account.
  await dropRelatedLink(tx, { tenantId, contactId, accountId: targetId });

  return { kind: "ok", accountId: targetId, createdAccountId };
}

/**
 * Thrown inside a `withTenant` tx to abort + roll back when a contact-account
 * apply step fails partway (so no contact/account/link is left half-written).
 * The endpoint catches it and maps `.outcome` to an HTTP response.
 */
export class ContactAccountAbort extends Error {
  constructor(
    public outcome:
      | ApplyContactAccountResult
      | ApplyRelatedAccountsResult
      | ApplyReportsToResult
  ) {
    super("contact-account apply aborted");
    this.name = "ContactAccountAbort";
  }
}

export type ApplyReportsToResult =
  | { kind: "ok"; managerId: string | null }
  | { kind: "not_activated" }
  | { kind: "invalid_contact"; contactId: string }
  | { kind: "self_reference" };

/**
 * Apply a contact's "reports to" manager (`contact_reports_to_contact`, M2O)
 * inside the caller's `withTenant` tx — existing manager only (no create).
 *  - `contactId` (manager) → validate it exists in this tenant + isn't self,
 *    then REPLACE-link (one manager).
 *  - null → CLEAR.
 * Returns an error kind WITHOUT writing on invalid/self/not-activated.
 */
export async function applyContactReportsTo(
  tx: typeof db,
  args: {
    tenantId: string;
    userId: string | null;
    contactId: string;
    managerContactId: string | null;
  }
): Promise<ApplyReportsToResult> {
  const { tenantId, userId, contactId } = args;
  const managerId =
    typeof args.managerContactId === "string" &&
    args.managerContactId.trim() !== ""
      ? args.managerContactId
      : null;

  const rel = await resolveRelationshipByName(
    tx,
    tenantId,
    CONTACT_REPORTS_TO_CONTACT.name
  );
  if (!rel) return { kind: "not_activated" };

  if (!managerId) {
    await tx
      .delete(recordRelationships)
      .where(
        and(
          eq(recordRelationships.tenantId, tenantId),
          eq(recordRelationships.relationshipId, rel.id),
          eq(recordRelationships.sourceRecordId, contactId)
        )
      );
    return { kind: "ok", managerId: null };
  }

  if (managerId === contactId) return { kind: "self_reference" };

  const [manager] = await tx
    .select({ id: records.id })
    .from(records)
    .where(
      and(
        eq(records.tenantId, tenantId),
        eq(records.entityTypeId, rel.targetEntityTypeId),
        eq(records.id, managerId)
      )
    );
  if (!manager) return { kind: "invalid_contact", contactId: managerId };

  await createRecordLink(tx, {
    tenantId,
    userId,
    relationship: rel,
    sourceRecordId: contactId,
    targetRecordId: manager.id,
  });
  return { kind: "ok", managerId: manager.id };
}

/** The contact's manager ({id, label}) for hydrating the "Reports to" field. */
export async function loadReportsTo(
  tx: typeof db,
  args: { tenantId: string; contactId: string }
): Promise<{ id: string; label: string } | null> {
  const rel = await resolveRelationshipByName(
    tx,
    args.tenantId,
    CONTACT_REPORTS_TO_CONTACT.name
  );
  if (!rel) return null;
  const [link] = await tx
    .select({ target: recordRelationships.targetRecordId })
    .from(recordRelationships)
    .where(
      and(
        eq(recordRelationships.tenantId, args.tenantId),
        eq(recordRelationships.relationshipId, rel.id),
        eq(recordRelationships.sourceRecordId, args.contactId)
      )
    )
    .limit(1);
  if (!link) return null;
  const [manager] = await tx
    .select({ data: records.data })
    .from(records)
    .where(
      and(eq(records.tenantId, args.tenantId), eq(records.id, link.target))
    );
  const d = (manager?.data as Record<string, unknown>) ?? {};
  const fn = typeof d.firstName === "string" ? d.firstName : "";
  const ln = typeof d.lastName === "string" ? d.lastName : "";
  const label = `${fn} ${ln}`.trim() || link.target;
  return { id: link.target, label };
}

export interface RelatedAccountEntry {
  accountId?: string | null;
  newAccountName?: string | null;
}

export type ApplyRelatedAccountsResult =
  | {
      kind: "ok";
      linkedAccountIds: string[];
      added: number;
      removed: number;
      createdAccountIds: string[];
    }
  | { kind: "not_activated" }
  | { kind: "invalid_account"; accountId: string };

/**
 * Reconcile a contact's RELATED accounts (`contact_related_to_account`, M2M) to
 * a full desired set inside the caller's `withTenant` tx. Existing-id entries
 * are validated (tenant-scoped); `newAccountName` entries link an existing
 * same-named account if one exists, else create it. The set is filtered against
 * `primaryAccountId` (no self-overlap — a related account can't be the primary).
 * Adds the missing links, removes the extras (no replace — M2M). All validation
 * happens before link writes so the caller's tx stays all-or-nothing.
 */
export async function applyRelatedAccounts(
  tx: typeof db,
  args: {
    tenantId: string;
    userId: string | null;
    contactId: string;
    desired: RelatedAccountEntry[];
    primaryAccountId: string | null;
  }
): Promise<ApplyRelatedAccountsResult> {
  const { tenantId, userId, contactId, desired, primaryAccountId } = args;

  const rel = await resolveRelationshipByName(
    tx,
    tenantId,
    CONTACT_RELATED_TO_ACCOUNT.name
  );
  if (!rel) return { kind: "not_activated" };

  // 1. Resolve desired entries → account ids (validate existing; resolve-or-
  //    create new). Validation (which can return) precedes link writes.
  const desiredIds = new Set<string>();
  const createdAccountIds: string[] = [];
  for (const entry of desired) {
    const newName =
      typeof entry.newAccountName === "string" &&
      entry.newAccountName.trim() !== ""
        ? entry.newAccountName.trim()
        : null;
    const accId =
      typeof entry.accountId === "string" && entry.accountId.trim() !== ""
        ? entry.accountId
        : null;

    if (newName) {
      const existing = await findAccountByName(tx, {
        tenantId,
        accountEntityTypeId: rel.targetEntityTypeId,
        name: newName,
      });
      if (existing) {
        desiredIds.add(existing.id);
      } else {
        const [account] = await tx
          .insert(records)
          .values({
            tenantId,
            entityTypeId: rel.targetEntityTypeId,
            data: { name: newName, status: "prospect" },
            createdBy: userId,
            updatedBy: userId,
            ownedBy: userId,
          })
          .returning();
        desiredIds.add(account.id);
        createdAccountIds.push(account.id);
        await writeAuditLog(tx, {
          tenantId,
          userId,
          action: "create",
          resourceType: "account",
          resourceId: account.id,
          changes: { after: account.data },
        });
      }
    } else if (accId) {
      const [acc] = await tx
        .select({ id: records.id })
        .from(records)
        .where(
          and(
            eq(records.tenantId, tenantId),
            eq(records.entityTypeId, rel.targetEntityTypeId),
            eq(records.id, accId)
          )
        );
      if (!acc) return { kind: "invalid_account", accountId: accId };
      desiredIds.add(acc.id);
    }
  }

  // No self-overlap with the primary.
  if (primaryAccountId) desiredIds.delete(primaryAccountId);

  // 2. Current related links → diff against desired.
  const currentRows = await tx
    .select({ target: recordRelationships.targetRecordId })
    .from(recordRelationships)
    .where(
      and(
        eq(recordRelationships.tenantId, tenantId),
        eq(recordRelationships.relationshipId, rel.id),
        eq(recordRelationships.sourceRecordId, contactId)
      )
    );
  const current = new Set(currentRows.map((r) => r.target));
  const toAdd = [...desiredIds].filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !desiredIds.has(id));

  // 3. Remove extras.
  if (toRemove.length > 0) {
    await tx
      .delete(recordRelationships)
      .where(
        and(
          eq(recordRelationships.tenantId, tenantId),
          eq(recordRelationships.relationshipId, rel.id),
          eq(recordRelationships.sourceRecordId, contactId),
          inArray(recordRelationships.targetRecordId, toRemove)
        )
      );
    await writeAuditLog(tx, {
      tenantId,
      userId,
      action: "unlink",
      resourceType: "relationship",
      resourceId: contactId,
      changes: { relationshipName: rel.name, removed: toRemove.length },
    });
  }

  // 4. Add missing (M2M — real relationship, no replace).
  for (const id of toAdd) {
    await createRecordLink(tx, {
      tenantId,
      userId,
      relationship: rel,
      sourceRecordId: contactId,
      targetRecordId: id,
    });
  }

  return {
    kind: "ok",
    linkedAccountIds: [...desiredIds],
    added: toAdd.length,
    removed: toRemove.length,
    createdAccountIds,
  };
}

/**
 * For a set of contacts, resolve each one's PRIMARY account ({id, name}) —
 * used to fill the "Account" column of the account-detail contact tables. One
 * bounded pair of queries (links + account names). Runs inside `withTenant`.
 */
export async function loadPrimaryAccountsForContacts(
  tx: typeof db,
  args: { tenantId: string; contactIds: string[] }
): Promise<Record<string, { id: string; name: string }>> {
  const { tenantId, contactIds } = args;
  if (contactIds.length === 0) return {};
  const rel = await resolveRelationshipByName(
    tx,
    tenantId,
    CONTACT_BELONGS_TO_ACCOUNT.name
  );
  if (!rel) return {};

  const links = await tx
    .select({
      source: recordRelationships.sourceRecordId,
      target: recordRelationships.targetRecordId,
    })
    .from(recordRelationships)
    .where(
      and(
        eq(recordRelationships.tenantId, tenantId),
        eq(recordRelationships.relationshipId, rel.id),
        inArray(recordRelationships.sourceRecordId, contactIds)
      )
    );
  const accountIds = [...new Set(links.map((l) => l.target))];
  if (accountIds.length === 0) return {};

  const accounts = await tx
    .select({ id: records.id, data: records.data })
    .from(records)
    .where(
      and(eq(records.tenantId, tenantId), inArray(records.id, accountIds))
    );
  const nameById = new Map(
    accounts.map((a) => [a.id, (a.data as { name?: string }).name ?? a.id])
  );

  const out: Record<string, { id: string; name: string }> = {};
  for (const l of links) {
    if (!out[l.source]) {
      out[l.source] = { id: l.target, name: nameById.get(l.target) ?? l.target };
    }
  }
  return out;
}

/** Account address slug → the contact's site-address slug it maps onto. */
const ACCOUNT_TO_SITE_ADDRESS: Record<string, string> = {
  addressLine1: "siteAddressLine1",
  addressLine2: "siteAddressLine2",
  city: "city",
  stateCounty: "stateCounty",
  postcode: "postcode",
  country: "country",
};

/**
 * The site-address subset to copy onto a contact whose "Same as Site account
 * address" is ticked — read from its primary account's address fields. Runs
 * inside `withTenant`. Returns `{}` when there's no account / no address.
 */
export async function inheritAccountAddress(
  tx: typeof db,
  args: { tenantId: string; accountId: string }
): Promise<Record<string, unknown>> {
  const [account] = await tx
    .select({ data: records.data })
    .from(records)
    .where(
      and(eq(records.tenantId, args.tenantId), eq(records.id, args.accountId))
    );
  const ad = (account?.data as Record<string, unknown>) ?? {};
  const out: Record<string, unknown> = {};
  for (const [accSlug, siteSlug] of Object.entries(ACCOUNT_TO_SITE_ADDRESS)) {
    out[siteSlug] = typeof ad[accSlug] === "string" ? ad[accSlug] : "";
  }
  return out;
}

/** The contact's current PRIMARY account id, or null if none. */
export async function getPrimaryAccountId(
  tx: typeof db,
  args: { tenantId: string; contactId: string }
): Promise<string | null> {
  const rel = await resolveRelationshipByName(
    tx,
    args.tenantId,
    CONTACT_BELONGS_TO_ACCOUNT.name
  );
  if (!rel) return null;
  const [row] = await tx
    .select({ target: recordRelationships.targetRecordId })
    .from(recordRelationships)
    .where(
      and(
        eq(recordRelationships.tenantId, args.tenantId),
        eq(recordRelationships.relationshipId, rel.id),
        eq(recordRelationships.sourceRecordId, args.contactId)
      )
    )
    .limit(1);
  return row?.target ?? null;
}

/** Delete a single contact→account RELATED link, if present. No-op otherwise. */
async function dropRelatedLink(
  tx: typeof db,
  args: { tenantId: string; contactId: string; accountId: string }
): Promise<void> {
  const rel = await resolveRelationshipByName(
    tx,
    args.tenantId,
    CONTACT_RELATED_TO_ACCOUNT.name
  );
  if (!rel) return;
  await tx
    .delete(recordRelationships)
    .where(
      and(
        eq(recordRelationships.tenantId, args.tenantId),
        eq(recordRelationships.relationshipId, rel.id),
        eq(recordRelationships.sourceRecordId, args.contactId),
        eq(recordRelationships.targetRecordId, args.accountId)
      )
    );
}

/**
 * Is `accountId` the contact's current PRIMARY account? Used by the WS2 link
 * route to reject adding a related link to the contact's own primary
 * (no-self-overlap), from either side of the edge.
 */
export async function isPrimaryAccountOf(
  tx: typeof db,
  args: { tenantId: string; contactId: string; accountId: string }
): Promise<boolean> {
  const rel = await resolveRelationshipByName(
    tx,
    args.tenantId,
    CONTACT_BELONGS_TO_ACCOUNT.name
  );
  if (!rel) return false;
  const [row] = await tx
    .select({ id: recordRelationships.id })
    .from(recordRelationships)
    .where(
      and(
        eq(recordRelationships.tenantId, args.tenantId),
        eq(recordRelationships.relationshipId, rel.id),
        eq(recordRelationships.sourceRecordId, args.contactId),
        eq(recordRelationships.targetRecordId, args.accountId)
      )
    );
  return !!row;
}
