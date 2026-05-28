import type { db } from "@adserve/database";
import type {
  Layout,
  LayoutConfig,
  LayoutSection,
  FieldDefinitionWithLabels,
} from "./types";

/**
 * Layout engine — STUB.
 *
 * Implementation lands in Task 0.3. Operates on `layouts.config` JSONB
 * using the structured `LayoutConfig` type from `./types`.
 */

type Tx = typeof db;

export type LayoutType = "detail" | "list" | "create";

export interface CreateLayoutInput {
  tenantId: string;
  entityTypeId: string;
  layoutType: LayoutType;
  name: string;
  isDefault?: boolean;
  config: LayoutConfig;
  assignedRoles?: string[];
}

export async function createLayout(
  _tx: Tx,
  _input: CreateLayoutInput
): Promise<Layout> {
  throw new Error("createLayout not implemented (Task 0.3)");
}

export async function updateLayoutConfig(
  _tx: Tx,
  _args: { layoutId: string; tenantId: string; config: LayoutConfig }
): Promise<Layout> {
  throw new Error("updateLayoutConfig not implemented (Task 0.3)");
}

export async function deleteLayout(
  _tx: Tx,
  _args: { layoutId: string; tenantId: string }
): Promise<void> {
  throw new Error("deleteLayout not implemented (Task 0.3)");
}

export async function getDefaultLayout(
  _tx: Tx,
  _args: { tenantId: string; entityTypeId: string; layoutType: LayoutType }
): Promise<Layout | null> {
  throw new Error("getDefaultLayout not implemented (Task 0.3)");
}

/**
 * Generate a sensible default `LayoutConfig` from a list of field
 * definitions. Used at module activation when a tenant gets a fresh
 * entity type and needs a starting layout.
 *
 * Pure function — no DB access, safe to call from anywhere.
 */
export function generateDefaultLayoutConfig(
  _fields: FieldDefinitionWithLabels[]
): LayoutConfig {
  throw new Error("generateDefaultLayoutConfig not implemented (Task 0.3)");
}

/**
 * Validate that a `LayoutConfig` is well-formed: every fieldId
 * references an existing field, sections have valid column counts,
 * no field appears twice across sections.
 */
export function validateLayoutConfig(
  _config: LayoutConfig,
  _availableFieldIds: Set<string>
): { ok: true } | { ok: false; errors: string[] } {
  throw new Error("validateLayoutConfig not implemented (Task 0.3)");
}

// Re-export for convenience.
export type { LayoutSection, LayoutConfig };
