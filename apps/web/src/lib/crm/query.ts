import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { records } from "@adserve/database";
import type { FieldDefinitionWithLabels } from "@adserve/module-framework";
import {
  isSortable,
  operatorsForType,
} from "@/components/dynamic-table/operators";
import type { Filter, SortState } from "@/components/dynamic-table/types";

/**
 * Server-side JSONB query construction for the CRM list endpoint.
 *
 * Honours the exact same eligibility vocabulary the client emits
 * (`operators.ts`): a filter is rejected unless its operator is in
 * `operatorsForType(field.fieldType)`, and a sort is rejected unless
 * `isSortable(field.fieldType)`.
 *
 * Safety: the field slug is validated against the entity's field
 * definitions before use; every value is a bound parameter; the SQL cast
 * is chosen from a fixed allowlist keyed by the declared field type — no
 * raw user input is interpolated into SQL.
 *
 * Storage shapes (verified against coerceFieldValue):
 *   - currency → { amount, currency }  → sort/filter on `data->slug->>'amount'`
 *   - multi_select → top-level string array → containment via `data->slug ? value`
 */

export class CrmQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmQueryError";
  }
}

export interface ParsedListParams {
  offset: number;
  limit: number;
  includeArchived: boolean;
  sort: SortState | null;
  filters: Filter[];
  /** Raw owner-filter token: a userId, "me", "unassigned", or null. */
  owner: string | null;
}

/**
 * Owner filter on the `records.ownedBy` column (a system column, not a
 * JSONB data field — so it lives outside the field-driven filter bar).
 */
export type OwnerFilter =
  | { kind: "user"; userId: string }
  | { kind: "unassigned" };

/**
 * Resolve a raw owner token into a concrete filter. "me" resolves to the
 * current session user (kept server-side so the URL stays shareable).
 * Returns null when there is no owner filter.
 */
export function resolveOwnerFilter(
  token: string | null,
  currentUserId: string
): OwnerFilter | null {
  if (!token) return null;
  if (token === "unassigned") return { kind: "unassigned" };
  if (token === "me") return { kind: "user", userId: currentUserId };
  return { kind: "user", userId: token };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const TEXT_TYPES = new Set([
  "text",
  "long_text",
  "email",
  "phone",
  "url",
]);

function parseIntParam(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new CrmQueryError(`Invalid integer: ${raw}`);
  return n;
}

export function parseListParams(sp: URLSearchParams): ParsedListParams {
  const offset = Math.max(0, parseIntParam(sp.get("offset"), 0));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseIntParam(sp.get("limit"), DEFAULT_LIMIT))
  );
  const includeArchived = sp.get("includeArchived") === "true";

  let sort: SortState | null = null;
  const sortRaw = sp.get("sort");
  if (sortRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(sortRaw);
    } catch {
      throw new CrmQueryError("sort is not valid JSON");
    }
    const s = parsed as { fieldSlug?: unknown; direction?: unknown };
    if (
      typeof s?.fieldSlug !== "string" ||
      (s.direction !== "asc" && s.direction !== "desc")
    ) {
      throw new CrmQueryError("sort must be { fieldSlug, direction: asc|desc }");
    }
    sort = { fieldSlug: s.fieldSlug, direction: s.direction };
  }

  let filters: Filter[] = [];
  const filtersRaw = sp.get("filters");
  if (filtersRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(filtersRaw);
    } catch {
      throw new CrmQueryError("filters is not valid JSON");
    }
    if (!Array.isArray(parsed)) {
      throw new CrmQueryError("filters must be a JSON array");
    }
    filters = parsed.map((f) => {
      const ff = f as { fieldSlug?: unknown; operator?: unknown; value?: unknown };
      if (typeof ff?.fieldSlug !== "string" || typeof ff?.operator !== "string") {
        throw new CrmQueryError("each filter needs fieldSlug + operator");
      }
      return {
        fieldSlug: ff.fieldSlug,
        operator: ff.operator as Filter["operator"],
        value: (ff.value ?? null) as Filter["value"],
      };
    });
  }

  const ownerRaw = sp.get("owner");
  const owner = ownerRaw && ownerRaw.trim() !== "" ? ownerRaw : null;

  return { offset, limit, includeArchived, sort, filters, owner };
}

function indexFields(
  fields: FieldDefinitionWithLabels[]
): Map<string, FieldDefinitionWithLabels> {
  return new Map(fields.map((f) => [f.slug, f]));
}

function asString(value: unknown): string {
  if (typeof value !== "string") {
    throw new CrmQueryError("Expected a string filter value");
  }
  return value;
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new CrmQueryError("Expected a numeric filter value");
  }
  return n;
}

function asPair(value: unknown): [string, string] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== "string" ||
    typeof value[1] !== "string"
  ) {
    throw new CrmQueryError("between expects a [from, to] pair");
  }
  return [value[0], value[1]];
}

/** Escape LIKE/ILIKE wildcards in user input (default backslash escape). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function textExpr(slug: string): SQL {
  return sql`(${records.data} ->> ${slug})`;
}
function numExpr(field: FieldDefinitionWithLabels): SQL {
  if (field.fieldType === "currency") {
    return sql`(${records.data} -> ${field.slug} ->> 'amount')::numeric`;
  }
  return sql`(${records.data} ->> ${field.slug})::numeric`;
}

function buildFilterCondition(
  field: FieldDefinitionWithLabels,
  filter: Filter
): SQL {
  const ft = field.fieldType;
  const op = filter.operator;
  const slug = field.slug;

  if (TEXT_TYPES.has(ft)) {
    const e = textExpr(slug);
    const s = asString(filter.value);
    if (op === "contains") return sql`${e} ilike ${`%${escapeLike(s)}%`}`;
    if (op === "equals") return sql`${e} = ${s}`;
    if (op === "startsWith") return sql`${e} ilike ${`${escapeLike(s)}%`}`;
  } else if (ft === "select") {
    const e = textExpr(slug);
    const s = asString(filter.value);
    if (op === "is") return sql`${e} = ${s}`;
    if (op === "isNot") return sql`${e} is distinct from ${s}`;
  } else if (ft === "number" || ft === "currency") {
    const e = numExpr(field);
    if (op === "equals") return sql`${e} = ${asNumber(filter.value)}`;
    if (op === "gt") return sql`${e} > ${asNumber(filter.value)}`;
    if (op === "lt") return sql`${e} < ${asNumber(filter.value)}`;
    if (op === "between") {
      const [lo, hi] = asPair(filter.value);
      return sql`${e} between ${Number(lo)} and ${Number(hi)}`;
    }
  } else if (ft === "date") {
    const e = sql`(${records.data} ->> ${slug})::date`;
    if (op === "before") return sql`${e} < ${asString(filter.value)}::date`;
    if (op === "after") return sql`${e} > ${asString(filter.value)}::date`;
    if (op === "between") {
      const [lo, hi] = asPair(filter.value);
      return sql`${e} between ${lo}::date and ${hi}::date`;
    }
  } else if (ft === "datetime") {
    const e = sql`(${records.data} ->> ${slug})::timestamptz`;
    if (op === "before")
      return sql`${e} < ${asString(filter.value)}::timestamptz`;
    if (op === "after")
      return sql`${e} > ${asString(filter.value)}::timestamptz`;
    if (op === "between") {
      const [lo, hi] = asPair(filter.value);
      return sql`${e} between ${lo}::timestamptz and ${hi}::timestamptz`;
    }
  } else if (ft === "boolean") {
    const e = sql`(${records.data} ->> ${slug})::boolean`;
    if (op === "isTrue") return sql`${e} = true`;
    if (op === "isFalse") return sql`${e} = false`;
  } else if (ft === "multi_select") {
    const f = sql`(${records.data} -> ${slug})`;
    const s = asString(filter.value);
    if (op === "has") return sql`${f} ? ${s}`;
    if (op === "hasNot") return sql`not (${f} ? ${s})`;
  }

  // Should be unreachable — operator eligibility is checked before this.
  throw new CrmQueryError(`Operator ${op} is not supported for ${ft} fields`);
}

export function buildWhere(
  tenantId: string,
  entityTypeId: string,
  fields: FieldDefinitionWithLabels[],
  filters: Filter[],
  includeArchived: boolean,
  ownerFilter?: OwnerFilter | null
): SQL {
  const bySlug = indexFields(fields);
  const conditions: SQL[] = [
    eq(records.tenantId, tenantId),
    eq(records.entityTypeId, entityTypeId),
  ];
  if (!includeArchived) {
    conditions.push(eq(records.isArchived, false));
  }
  if (ownerFilter) {
    conditions.push(
      ownerFilter.kind === "unassigned"
        ? isNull(records.ownedBy)
        : eq(records.ownedBy, ownerFilter.userId)
    );
  }

  for (const filter of filters) {
    const field = bySlug.get(filter.fieldSlug);
    if (!field) {
      throw new CrmQueryError(`Unknown filter field: ${filter.fieldSlug}`);
    }
    const allowed = operatorsForType(field.fieldType).some(
      (o) => o.value === filter.operator
    );
    if (!allowed) {
      throw new CrmQueryError(
        `Operator ${filter.operator} not allowed for ${field.fieldType} field "${field.slug}"`
      );
    }
    conditions.push(buildFilterCondition(field, filter));
  }

  return and(...conditions) as SQL;
}

export function sortExpr(field: FieldDefinitionWithLabels): SQL {
  const ft = field.fieldType;
  if (ft === "number" || ft === "currency") return numExpr(field);
  if (ft === "date") return sql`(${records.data} ->> ${field.slug})::date`;
  if (ft === "datetime")
    return sql`(${records.data} ->> ${field.slug})::timestamptz`;
  if (ft === "boolean")
    return sql`(${records.data} ->> ${field.slug})::boolean`;
  return textExpr(field.slug);
}

export function buildOrderBy(
  fields: FieldDefinitionWithLabels[],
  sort: SortState | null
): SQL | null {
  if (!sort) return null;
  const field = indexFields(fields).get(sort.fieldSlug);
  if (!field) {
    throw new CrmQueryError(`Unknown sort field: ${sort.fieldSlug}`);
  }
  if (!isSortable(field.fieldType)) {
    throw new CrmQueryError(`Field "${field.slug}" is not sortable`);
  }
  const dir = sort.direction === "desc" ? sql`desc` : sql`asc`;
  return sql`${sortExpr(field)} ${dir} nulls last`;
}
