import type { db } from "@adserve/database";
import type { EntityType, EntityTypeInsert } from "./types";

/**
 * Entity registry — STUB.
 *
 * Implementation lands in Task 0.6. Wraps the `entity_types` table with
 * tenant-scoped CRUD + lookup by slug.
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

export async function registerEntityType(
  _tx: Tx,
  _input: RegisterEntityTypeInput
): Promise<EntityType> {
  throw new Error("registerEntityType not implemented (Task 0.6)");
}

export async function getEntityTypeBySlug(
  _tx: Tx,
  _args: { tenantId: string; slug: string }
): Promise<EntityType | null> {
  throw new Error("getEntityTypeBySlug not implemented (Task 0.6)");
}

export async function listEntityTypesForModule(
  _tx: Tx,
  _args: { tenantId: string; moduleId: string }
): Promise<EntityType[]> {
  throw new Error("listEntityTypesForModule not implemented (Task 0.6)");
}

export type { EntityType, EntityTypeInsert };
