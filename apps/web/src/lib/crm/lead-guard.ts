/**
 * AC 24 — a converted lead is server-side read-only for EVERYONE. The guard
 * fires before the permission/ownership gate (a converted lead can't be edited
 * even by its owner). v3.2 extends "read-only" beyond PATCH to cover archive
 * (DELETE) and relationship link/unlink, so the invariant holds now that
 * convert can attach a Campaign or Opportunity.
 *
 * Precise: only the `lead` entity type, only when `data.status === "Converted"`.
 */
export function isConvertedLead(slug: string, data: unknown): boolean {
  if (slug !== "lead") return false;
  return (data as { status?: unknown } | null | undefined)?.status === "Converted";
}
