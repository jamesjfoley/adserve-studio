import type {
  EntityType,
  FieldDefinitionWithLabels,
} from "@adserve/module-framework";

/**
 * Resolve a human-readable title for a record.
 *
 * Order: the entity type's configured name field (accounts/opportunities use
 * `name`) → an explicit `data.name` → a composed `firstName lastName`
 * (contacts/leads have no single name field — their display name is composed
 * app-side, so `nameFieldId` is null) → the supplied `fallback` (the detail
 * page passes the record id) when nothing else yields a value.
 *
 * Pure + synchronous so it is unit-testable without a DB.
 */
export function recordTitle(
  entity: Pick<EntityType, "nameFieldId">,
  fields: FieldDefinitionWithLabels[],
  data: Record<string, unknown>,
  fallback: string
): string {
  if (entity.nameFieldId) {
    const field = fields.find((f) => f.id === entity.nameFieldId);
    if (field) {
      const value = data[field.slug];
      if (typeof value === "string" && value.trim() !== "") return value;
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
    }
  }

  // No usable configured name field — derive a display name.
  const name = data.name;
  if (typeof name === "string" && name.trim() !== "") return name;

  const first = typeof data.firstName === "string" ? data.firstName : "";
  const last = typeof data.lastName === "string" ? data.lastName : "";
  const full = `${first} ${last}`.trim();
  if (full !== "") return full;

  return fallback;
}
