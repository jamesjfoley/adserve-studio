// ============================================================
// Client-safe surface of @adserve/module-framework
// ============================================================
//
// The package index re-exports server-only modules (field-engine,
// layout-engine, entity-registry, …) that import @adserve/database, whose
// client instantiates the `postgres` driver at module load. Importing those
// into a client component drags `postgres` (and node built-ins net/tls/fs/
// perf_hooks) into the browser bundle and breaks `next build`.
//
// This module is DB-free: it re-exports only pure values + types that client
// components legitimately need. Import client-side from
// "@adserve/module-framework/client"; server code keeps using the index.

export { coerceFieldValue, type CoercionResult, type FieldCoercionSpec } from "./coercion";
export { resolveLabel } from "./types";
export type {
  FieldDefinitionWithLabels,
  LayoutConfig,
  LayoutSection,
  LocalizedLabel,
  FieldType,
  CurrencyValue,
} from "./types";
