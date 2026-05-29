import type {
  EntityType,
  FieldDefinitionWithLabels,
} from "@adserve/module-framework";

/**
 * Resolve a human-readable title for a record from its entity type's
 * configured name field. Falls back to the supplied `fallback` (the
 * detail page passes the record id) when the entity has no `nameFieldId`,
 * the named field no longer exists, or its value is empty.
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
  return fallback;
}
