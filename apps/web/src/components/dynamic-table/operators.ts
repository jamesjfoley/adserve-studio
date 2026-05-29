import type { FieldType } from "@adserve/module-framework";

/**
 * Field-type-aware filter operators + sort eligibility. This is the
 * single tested place that decides, per field type, which filter
 * operators apply and whether a column can be sorted at all.
 *
 * Sort eligibility matters because the server sorts via
 * `(data->>'slug')::<type>` casts — array (multi_select) and
 * relationship columns have no meaningful scalar cast, so their headers
 * must not offer sorting. Filter and sort eligibility therefore live
 * together rather than drifting apart in the UI components.
 */

export type FilterOperator =
  // text family
  | "contains"
  | "equals"
  | "startsWith"
  // number family
  | "gt"
  | "lt"
  | "between"
  // date family
  | "before"
  | "after"
  // select family
  | "is"
  | "isNot"
  // boolean family
  | "isTrue"
  | "isFalse"
  // multi_select family
  | "has"
  | "hasNot";

/** How the filter bar renders the value input for a given operator. */
export type OperatorInputKind =
  | "text"
  | "number"
  | "date"
  | "datetime"
  | "select"
  | "between-number"
  | "between-date"
  | "between-datetime"
  | "none";

export interface OperatorSpec {
  value: FilterOperator;
  label: string;
  input: OperatorInputKind;
}

const TEXT_OPERATORS: OperatorSpec[] = [
  { value: "contains", label: "Contains", input: "text" },
  { value: "equals", label: "Equals", input: "text" },
  { value: "startsWith", label: "Starts with", input: "text" },
];

const NUMBER_OPERATORS: OperatorSpec[] = [
  { value: "equals", label: "Equals", input: "number" },
  { value: "gt", label: "Greater than", input: "number" },
  { value: "lt", label: "Less than", input: "number" },
  { value: "between", label: "Between", input: "between-number" },
];

function dateOperators(kind: "date" | "datetime"): OperatorSpec[] {
  const single = kind;
  const between = kind === "date" ? "between-date" : "between-datetime";
  return [
    { value: "before", label: "Before", input: single },
    { value: "after", label: "After", input: single },
    { value: "between", label: "Between", input: between as OperatorInputKind },
  ];
}

const SELECT_OPERATORS: OperatorSpec[] = [
  { value: "is", label: "Is", input: "select" },
  { value: "isNot", label: "Is not", input: "select" },
];

const BOOLEAN_OPERATORS: OperatorSpec[] = [
  { value: "isTrue", label: "Is true", input: "none" },
  { value: "isFalse", label: "Is false", input: "none" },
];

const MULTI_SELECT_OPERATORS: OperatorSpec[] = [
  { value: "has", label: "Has", input: "select" },
  { value: "hasNot", label: "Does not have", input: "select" },
];

/**
 * Filter operators available for a field type. An empty array means the
 * type is not filterable (relationship + non-data types).
 */
export function operatorsForType(fieldType: FieldType): OperatorSpec[] {
  switch (fieldType) {
    case "text":
    case "long_text":
    case "email":
    case "phone":
    case "url":
      return TEXT_OPERATORS;
    case "number":
    case "currency":
      return NUMBER_OPERATORS;
    case "date":
      return dateOperators("date");
    case "datetime":
      return dateOperators("datetime");
    case "select":
      return SELECT_OPERATORS;
    case "boolean":
      return BOOLEAN_OPERATORS;
    case "multi_select":
      return MULTI_SELECT_OPERATORS;
    // relationship + user/file/image/json/computed/ai_generated: not
    // filterable in Phase 1.
    default:
      return [];
  }
}

/**
 * Field types that sort meaningfully via a scalar cast. multi_select
 * (array) and relationship (id) are deliberately excluded.
 */
export const SORTABLE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "text",
  "long_text",
  "email",
  "phone",
  "url",
  "number",
  "currency",
  "date",
  "datetime",
  "boolean",
  "select",
]);

export function isSortable(fieldType: FieldType): boolean {
  return SORTABLE_TYPES.has(fieldType);
}

export function isFilterable(fieldType: FieldType): boolean {
  return operatorsForType(fieldType).length > 0;
}
