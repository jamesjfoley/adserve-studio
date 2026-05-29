import {
  generateDefaultLayoutConfig,
  getDefaultLayout,
  getEntityTypeBySlug,
  listFieldDefinitions,
  type EntityType,
  type FieldDefinitionWithLabels,
  type LayoutConfig,
} from "@adserve/module-framework";
import type { db } from "@adserve/database";

export interface EntityFormBundle {
  entity: EntityType;
  fields: FieldDefinitionWithLabels[];
  /** The activated `detail` layout, or a generated fallback if absent. */
  layoutConfig: LayoutConfig;
}

/**
 * Resolve the entity type, its field definitions, and its `detail` layout
 * (falling back to a generated layout) for a CRM entity slug. This is the
 * shared "server-component form wrapper" piece consumed by both the list
 * page (the "New" form) and the detail page (view/edit form) so the two
 * never drift in how they hydrate `<DynamicForm>`.
 *
 * Returns null when the entity type is not registered for the tenant (CRM
 * not activated). Runs inside the caller's tenant transaction.
 */
export async function loadEntityForm(
  tx: typeof db,
  args: { tenantId: string; slug: string }
): Promise<EntityFormBundle | null> {
  const { tenantId, slug } = args;

  const entity = await getEntityTypeBySlug(tx, { tenantId, slug });
  if (!entity) return null;

  const fields = await listFieldDefinitions(tx, {
    tenantId,
    entityTypeId: entity.id,
  });

  const layoutRow = await getDefaultLayout(tx, {
    tenantId,
    entityTypeId: entity.id,
    layoutType: "detail",
  });
  const layoutConfig =
    (layoutRow?.config as LayoutConfig | undefined) ??
    (await generateDefaultLayoutConfig(tx, {
      tenantId,
      entityTypeId: entity.id,
    }));

  return { entity, fields, layoutConfig };
}
