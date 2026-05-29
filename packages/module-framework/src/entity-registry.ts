import { and, asc, eq } from "drizzle-orm";
import { db, entityTypes } from "@adserve/database";
import type { EntityType, EntityTypeInsert } from "./types";

/**
 * Entity registry.
 *
 * Tenant-scoped CRUD + lookup over the `entity_types` table. Activation
 * flows (Task 0.6 `provisionEntityType` / CRM `activateCrmForTenant`)
 * register entity types here; list/detail pages and the API layer read
 * them back by slug.
 *
 * Tenant scoping is non-negotiable: a lookup for one tenant must never
 * surface an entity type owned by another. `getEntityTypeBySlug` returns
 * null for a slug that exists only in a different tenant.
 */

type Tx = typeof db;

export interface RegisterEntityTypeInput {
  tenantId: string;
  moduleId: string;
  name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  isSystem?: boolean;
  settings?: Record<string, unknown>;
}

/**
 * Register an entity type for a tenant. Idempotent on the natural key
 * `(tenantId, slug)` — re-registering an existing slug returns the
 * existing row unchanged (no clobber of settings / nameFieldId set by a
 * later provisioning step).
 */
export async function registerEntityType(
  tx: Tx,
  input: RegisterEntityTypeInput
): Promise<EntityType> {
  const values: EntityTypeInsert = {
    tenantId: input.tenantId,
    moduleId: input.moduleId,
    name: input.name,
    slug: input.slug,
    description: input.description ?? null,
    icon: input.icon ?? null,
    isSystem: input.isSystem ?? false,
    ...(input.settings ? { settings: input.settings } : {}),
  };

  const [inserted] = await tx
    .insert(entityTypes)
    .values(values)
    .onConflictDoNothing({
      target: [entityTypes.tenantId, entityTypes.slug],
    })
    .returning();

  if (inserted) return inserted;

  // Conflict → the row already exists. Return it as-is.
  const existing = await getEntityTypeBySlug(tx, {
    tenantId: input.tenantId,
    slug: input.slug,
  });
  if (!existing) {
    // Should be unreachable: a conflict means a row exists for this
    // (tenantId, slug). Guard anyway so a surprising state is loud.
    throw new Error(
      `registerEntityType: conflict on (tenant, slug=${input.slug}) but no existing row found`
    );
  }
  return existing;
}

export async function getEntityTypeBySlug(
  tx: Tx,
  args: { tenantId: string; slug: string }
): Promise<EntityType | null> {
  const [row] = await tx
    .select()
    .from(entityTypes)
    .where(
      and(
        eq(entityTypes.tenantId, args.tenantId),
        eq(entityTypes.slug, args.slug)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function listEntityTypesForModule(
  tx: Tx,
  args: { tenantId: string; moduleId: string }
): Promise<EntityType[]> {
  return tx
    .select()
    .from(entityTypes)
    .where(
      and(
        eq(entityTypes.tenantId, args.tenantId),
        eq(entityTypes.moduleId, args.moduleId)
      )
    )
    .orderBy(asc(entityTypes.slug));
}

export type { EntityType, EntityTypeInsert };
