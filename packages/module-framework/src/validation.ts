import type { db } from "@adserve/database";
import type {
  ValidationRule,
  ValidationCondition,
  ValidationAction,
} from "./types";

/**
 * Validation rules adapter — STUB.
 *
 * Implementation lands in Task 0.2 alongside the field engine. The
 * adapter is the bridge between `field_definitions` (declarative
 * `isRequired` / `isUnique` flags) and the `validation_rules` table
 * (richer rules like min/max length, regex, custom expressions).
 *
 * Engine maintains both layers consistently: setting `isRequired: true`
 * on a field auto-creates a "required" rule in `validation_rules`;
 * deleting it auto-removes the rule.
 */

type Tx = typeof db;

export interface CreateValidationRuleInput {
  tenantId: string;
  entityTypeId: string;
  name: string;
  condition: ValidationCondition;
  action: ValidationAction;
  errorMessage: string;
  isActive?: boolean;
}

export async function createValidationRule(
  _tx: Tx,
  _input: CreateValidationRuleInput
): Promise<ValidationRule> {
  throw new Error("createValidationRule not implemented (Task 0.2)");
}

export async function listValidationRules(
  _tx: Tx,
  _args: { tenantId: string; entityTypeId: string; activeOnly?: boolean }
): Promise<ValidationRule[]> {
  throw new Error("listValidationRules not implemented (Task 0.2)");
}

export async function deleteValidationRule(
  _tx: Tx,
  _args: { ruleId: string; tenantId: string }
): Promise<void> {
  throw new Error("deleteValidationRule not implemented (Task 0.2)");
}

/**
 * Evaluate every active rule against a candidate `data` object for the
 * given entity type. Returns the list of violated rules + their error
 * messages, or `null` on no violations.
 *
 * Pure-ish: reads rules from the DB but does not write. Called on every
 * record insert/update.
 */
export async function evaluateRules(
  _tx: Tx,
  _args: {
    tenantId: string;
    entityTypeId: string;
    data: Record<string, unknown>;
    /** Existing record id, when evaluating an UPDATE (excluded from unique checks). */
    excludeRecordId?: string;
  }
): Promise<
  | { ok: true }
  | { ok: false; violations: Array<{ rule: ValidationRule; message: string }> }
> {
  throw new Error("evaluateRules not implemented (Task 0.2)");
}

export type { ValidationCondition, ValidationAction };
