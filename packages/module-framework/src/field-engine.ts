import type { db } from "@adserve/database";

/**
 * Field definition engine — STUB.
 *
 * Implementation lands in Task 0.2. The exports below are the contract
 * the skeleton tests in `__tests__/field-engine.test.ts` lock in.
 *
 * Each function throws "not implemented" so tests written against this
 * shape fail loudly until Task 0.2 fills them in.
 */

type Tx = typeof db;

export type FieldType =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "datetime"
  | "boolean"
  | "select"
  | "multiselect"
  | "email"
  | "phone"
  | "url"
  | "textarea"
  | "relationship";

export interface CreateFieldDefinitionInput {
  tenantId: string;
  entityTypeId: string;
  name: string;
  slug: string;
  fieldType: FieldType;
  isRequired?: boolean;
  isSystem?: boolean;
  labels?: Record<string, string>;
  options?: Record<string, unknown>;
}

export interface FieldDefinitionRow {
  id: string;
  tenantId: string;
  entityTypeId: string;
  name: string;
  slug: string;
  fieldType: FieldType;
  isRequired: boolean;
  isSystem: boolean;
  labels: Record<string, string>;
  options: Record<string, unknown>;
}

export async function createFieldDefinition(
  _tx: Tx,
  _input: CreateFieldDefinitionInput
): Promise<FieldDefinitionRow> {
  throw new Error("createFieldDefinition not implemented (Task 0.2)");
}

export async function deleteFieldDefinition(
  _tx: Tx,
  _args: { fieldId: string; tenantId: string; force?: boolean }
): Promise<void> {
  throw new Error("deleteFieldDefinition not implemented (Task 0.2)");
}

export async function coerceFieldValue(
  _fieldType: FieldType,
  _value: unknown
): Promise<unknown> {
  throw new Error("coerceFieldValue not implemented (Task 0.2)");
}
