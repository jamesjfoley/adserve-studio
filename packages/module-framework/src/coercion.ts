// ============================================================
// coerceFieldValue — pure value coercion (NO DB)
// ============================================================
//
// Extracted from field-engine.ts so it can be imported by client
// components without dragging field-engine's @adserve/database (→ postgres)
// import into the browser bundle. field-engine.ts re-exports these for
// server-side back-compat; the client-safe surface is `@adserve/module-framework/client`.

import type { FieldType } from "./types";

export type CoercionResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };

/**
 * Shape the field-engine needs to coerce a value. Either pass a full
 * `FieldDefinitionWithLabels` row or construct a partial inline (handy
 * for tests).
 *
 * `options` is `unknown` rather than `Record<string, unknown>` so a
 * raw Drizzle row (whose jsonb fields infer as `unknown`) is
 * assignable without a cast. The body narrows internally.
 */
export interface FieldCoercionSpec {
  fieldType: FieldType;
  isRequired?: boolean | null;
  options?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

function err(code: string, message: string): CoercionResult {
  return { ok: false, error: { code, message } };
}

function ok(value: unknown): CoercionResult {
  return { ok: true, value };
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

export function coerceFieldValue(
  field: FieldCoercionSpec,
  value: unknown
): CoercionResult {
  // ---- required + nullable handling ----
  if (isNullish(value)) {
    if (field.isRequired) {
      return err("required", "This field is required.");
    }
    return ok(null);
  }

  const opts = (field.options ?? {}) as Record<string, unknown>;

  switch (field.fieldType) {
    // ---------- text / long_text ----------
    case "text":
    case "long_text": {
      if (typeof value !== "string") {
        return err("type", "Expected a string.");
      }
      const min = typeof opts.minLength === "number" ? opts.minLength : null;
      const max = typeof opts.maxLength === "number" ? opts.maxLength : null;
      if (min !== null && value.length < min) {
        return err("min_length", `Must be at least ${min} characters.`);
      }
      if (max !== null && value.length > max) {
        return err("max_length", `Must be at most ${max} characters.`);
      }
      if (typeof opts.pattern === "string") {
        try {
          if (!new RegExp(opts.pattern).test(value)) {
            return err("pattern", "Value does not match the required format.");
          }
        } catch {
          return err("invalid_pattern", "Field has an invalid regex pattern.");
        }
      }
      return ok(value);
    }

    // ---------- number ----------
    case "number": {
      let n: number;
      if (typeof value === "number") {
        n = value;
      } else if (typeof value === "string" && value.trim() !== "") {
        n = Number(value);
      } else {
        return err("type", "Expected a number.");
      }
      if (!Number.isFinite(n)) {
        return err("type", "Value is not a finite number.");
      }
      if (opts.integer === true && !Number.isInteger(n)) {
        return err("integer", "Value must be an integer.");
      }
      const min = typeof opts.min === "number" ? opts.min : null;
      const max = typeof opts.max === "number" ? opts.max : null;
      if (min !== null && n < min) {
        return err("min_value", `Must be at least ${min}.`);
      }
      if (max !== null && n > max) {
        return err("max_value", `Must be at most ${max}.`);
      }
      return ok(n);
    }

    // ---------- currency ----------
    case "currency": {
      if (typeof value !== "object" || value === null) {
        return err("type", "Expected an object with amount and currency.");
      }
      const v = value as { amount?: unknown; currency?: unknown };
      if (typeof v.currency !== "string" || !CURRENCY_CODE_RE.test(v.currency)) {
        return err(
          "invalid_currency",
          "currency must be a 3-letter uppercase ISO-4217 code."
        );
      }
      let amount: number;
      if (typeof v.amount === "number") amount = v.amount;
      else if (typeof v.amount === "string" && v.amount.trim() !== "")
        amount = Number(v.amount);
      else return err("type", "amount must be a number.");
      if (!Number.isFinite(amount)) {
        return err("type", "amount is not a finite number.");
      }
      const allowed = opts.allowedCurrencies;
      if (Array.isArray(allowed) && !allowed.includes(v.currency)) {
        return err(
          "currency_not_allowed",
          `Currency ${v.currency} is not in the allowed list.`
        );
      }
      return ok({ amount, currency: v.currency });
    }

    // ---------- date ----------
    case "date": {
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
          return err("type", "Invalid date.");
        }
        return ok(value.toISOString().slice(0, 10));
      }
      if (typeof value === "string" && DATE_RE.test(value)) {
        const d = new Date(value + "T00:00:00Z");
        if (Number.isNaN(d.getTime())) return err("type", "Invalid date.");
        return ok(value);
      }
      return err("type", "Expected a date in YYYY-MM-DD format.");
    }

    // ---------- datetime ----------
    case "datetime": {
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
          return err("type", "Invalid datetime.");
        }
        return ok(value.toISOString());
      }
      if (typeof value === "string") {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) {
          return err("type", "Expected an ISO datetime string.");
        }
        return ok(d.toISOString());
      }
      return err("type", "Expected an ISO datetime string or Date.");
    }

    // ---------- boolean ----------
    case "boolean": {
      if (typeof value === "boolean") return ok(value);
      if (value === "true") return ok(true);
      if (value === "false") return ok(false);
      return err("type", "Expected true or false.");
    }

    // ---------- select ----------
    case "select": {
      if (typeof value !== "string") {
        return err("type", "Expected a string choice value.");
      }
      const choices = (opts.choices ?? []) as Array<{ value: string }>;
      if (
        choices.length > 0 &&
        !choices.some((c) => c?.value === value)
      ) {
        return err(
          "not_in_choices",
          `Value "${value}" is not one of the allowed choices.`
        );
      }
      return ok(value);
    }

    // ---------- multi_select ----------
    case "multi_select": {
      if (!Array.isArray(value)) {
        return err("type", "Expected an array of choice values.");
      }
      const choices = (opts.choices ?? []) as Array<{ value: string }>;
      const allowedSet = new Set(choices.map((c) => c?.value));
      for (const v of value) {
        if (typeof v !== "string") {
          return err("type", "Every element must be a string.");
        }
        if (choices.length > 0 && !allowedSet.has(v)) {
          return err(
            "not_in_choices",
            `Value "${v}" is not one of the allowed choices.`
          );
        }
      }
      return ok(value);
    }

    // ---------- email ----------
    case "email": {
      if (typeof value !== "string" || !EMAIL_RE.test(value)) {
        return err("type", "Expected a valid email address.");
      }
      return ok(value.trim());
    }

    // ---------- phone ----------
    case "phone": {
      // International phone validation is messy; Phase 1 just accepts
      // any non-empty string and trims whitespace.
      if (typeof value !== "string") {
        return err("type", "Expected a phone number string.");
      }
      return ok(value.trim());
    }

    // ---------- url ----------
    case "url": {
      if (typeof value !== "string") {
        return err("type", "Expected a URL string.");
      }
      try {
        // Constructor throws on invalid URL.
        new URL(value);
      } catch {
        return err("type", "Expected a valid URL.");
      }
      return ok(value);
    }

    // ---------- relationship ----------
    case "relationship": {
      // The caller is responsible for routing this UUID into
      // record_relationships, not records.data.
      if (typeof value !== "string" || !UUID_RE.test(value)) {
        return err("type", "Expected a record UUID.");
      }
      return ok(value);
    }

    // ---------- Phase 2+ types — opaque pass-through ----------
    case "user":
    case "file":
    case "image":
    case "json":
    case "computed":
    case "ai_generated":
      return ok(value);

    default: {
      // Exhaustiveness check — TS catches at compile time.
      const _: never = field.fieldType;
      void _;
      return err("unsupported_type", `Unsupported field type.`);
    }
  }
}
