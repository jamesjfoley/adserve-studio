import type { db } from "@adserve/database";
import type {
  FieldDefinitionWithLabels,
  FieldType,
  LocalizedLabel,
} from "./types";

/**
 * Field definition engine — STUB.
 *
 * Implementation lands in Task 0.2 along with the `labels jsonb`
 * migration. The function shapes below are the contract the skeleton
 * tests in `__tests__/field-engine.test.ts` lock in.
 */

type Tx = typeof db;

export interface CreateFieldDefinitionInput {
  tenantId: string;
  entityTypeId: string;
  name: string;
  slug: string;
  fieldType: FieldType;
  isRequired?: boolean;
  isUnique?: boolean;
  isSystem?: boolean;
  defaultValue?: unknown;
  labels?: LocalizedLabel;
  options?: Record<string, unknown>;
  displayOrder?: number;
  groupName?: string | null;
  description?: string | null;
  isSearchable?: boolean;
  isFilterable?: boolean;
}

export interface DeleteFieldDefinitionArgs {
  fieldId: string;
  tenantId: string;
  /**
   * When `true`, deletes the field even if there are records with
   * populated data for its slug. The orphaned JSONB keys remain in
   * `records.data` — they just become unreferenced.
   */
  force?: boolean;
}

export async function createFieldDefinition(
  _tx: Tx,
  _input: CreateFieldDefinitionInput
): Promise<FieldDefinitionWithLabels> {
  throw new Error("createFieldDefinition not implemented (Task 0.2)");
}

export async function updateFieldDefinition(
  _tx: Tx,
  _args: {
    fieldId: string;
    tenantId: string;
    updates: Partial<
      Pick<
        CreateFieldDefinitionInput,
        | "name"
        | "labels"
        | "description"
        | "displayOrder"
        | "groupName"
        | "options"
        | "isSearchable"
        | "isFilterable"
      >
    >;
  }
): Promise<FieldDefinitionWithLabels> {
  throw new Error("updateFieldDefinition not implemented (Task 0.2)");
}

export async function deleteFieldDefinition(
  _tx: Tx,
  _args: DeleteFieldDefinitionArgs
): Promise<void> {
  throw new Error("deleteFieldDefinition not implemented (Task 0.2)");
}

export async function listFieldDefinitions(
  _tx: Tx,
  _args: { tenantId: string; entityTypeId: string }
): Promise<FieldDefinitionWithLabels[]> {
  throw new Error("listFieldDefinitions not implemented (Task 0.2)");
}

/**
 * Pure-function value coercion based on the declared field type.
 * Used both at write time and by the dynamic form renderer.
 *
 * Implementation lands in Task 0.2. Coercion rules per type are
 * documented in docs/phase-3-plan.md §Task 0.2.
 */
export async function coerceFieldValue(
  _fieldType: FieldType,
  _value: unknown
): Promise<unknown> {
  throw new Error("coerceFieldValue not implemented (Task 0.2)");
}
