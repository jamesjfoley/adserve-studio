import { and, eq } from "drizzle-orm";
import { records, recordRelationships, type db } from "@adserve/database";
import { CONTACT_BELONGS_TO_ACCOUNT } from "@adserve/crm";
import { findAccountByName } from "./account-name";
import { createRecordLink, resolveRelationshipByName } from "./link-records";
import { writeAuditLog } from "./audit";

/**
 * The single contact→account selection from a form submit. Mirrors the create
 * endpoint's routing: an existing account id, a new account name to create, or
 * neither (clear the link).
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
 * Apply a contact's single account selection inside the caller's `withTenant`
 * tx — the shared edit/create machinery for the prototype's one-account rule.
 *
 *  - `newAccountName` → validate unique (shared `findAccountByName`), create the
 *    account, then REPLACE-link.
 *  - `accountId` → validate it exists in this tenant, then REPLACE-link.
 *  - neither → CLEAR (remove any existing contact_belongs_to_account link).
 *
 * "Exactly one account" is enforced via the link layer's many_to_one REPLACE
 * branch: `createRecordLink` deletes any prior link of this relationship for the
 * source before inserting the new one. The registry stays many_to_many (no data
 * model change) — we pass `relationshipType: "many_to_one"` to opt into replace
 * semantics here only.
 *
 * Returns an error kind WITHOUT writing on duplicate/invalid/not-activated, so
 * the caller can abort before persisting other changes (single tx → atomic).
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

  // CLEAR — nothing selected → drop any existing account link(s) for this
  // contact + relationship.
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
    // Uniqueness — same normalisation as lead-convert (shared helper).
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
    // Existing account — resolve under the tenant's RLS context (a cross-tenant
    // id yields zero rows → rejected).
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

  // REPLACE-link via the many_to_one branch (deletes any prior account link for
  // this contact, then inserts the new one) — single account guaranteed.
  await createRecordLink(tx, {
    tenantId,
    userId,
    relationship: { id: rel.id, name: rel.name, relationshipType: "many_to_one" },
    sourceRecordId: contactId,
    targetRecordId: targetId,
  });

  return { kind: "ok", accountId: targetId, createdAccountId };
}
