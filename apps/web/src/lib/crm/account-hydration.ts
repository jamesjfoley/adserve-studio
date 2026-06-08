import { CONTACT_BELONGS_TO_ACCOUNT } from "@adserve/crm/relationships";
import type { RelatedRecord } from "./relationships";
import type { AccountSelection } from "@/components/crm/account-picker";

/**
 * Derive the account-field value for a contact's detail/edit form from its
 * loaded relationships, so the picker shows the linked account instead of "—".
 *
 * Client-safe: type-only imports (no DB). Scans related records for the
 * `contact_belongs_to_account` edge and returns the first as an existing
 * selection (the prototype enforces one account per contact). Prefers a
 * non-archived account. Returns null when there is no link.
 */
export function accountSelectionFromRelationships(
  relationships: Record<string, RelatedRecord[]>
): AccountSelection | null {
  const linked: RelatedRecord[] = [];
  for (const list of Object.values(relationships)) {
    for (const r of list) {
      if (r.relationshipName === CONTACT_BELONGS_TO_ACCOUNT.name) linked.push(r);
    }
  }
  if (linked.length === 0) return null;
  const acc = linked.find((r) => !r.isArchived) ?? linked[0];
  const name =
    typeof acc.data.name === "string" && acc.data.name.trim() !== ""
      ? acc.data.name
      : acc.id;
  return { kind: "existing", id: acc.id, label: name };
}
