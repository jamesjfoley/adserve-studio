"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { crmCollectionSegment } from "@adserve/crm/url";
import type {
  FieldDefinitionWithLabels,
  LayoutConfig,
} from "@adserve/module-framework";
import type { RelatedRecord } from "@/lib/crm/relationships";
import { DynamicForm } from "@/components/dynamic-form";
import { DynamicTable, ColumnToggle } from "@/components/dynamic-table";
import type {
  DynamicTableRecord,
  Filter,
  FilterState,
  SortState,
} from "@/components/dynamic-table";
import {
  isSortable,
  isTextFilterable,
  operatorsForType,
} from "@/components/dynamic-table/operators";
import { PermissionGate } from "@/lib/permissions-client";
import { usePersistentState } from "@/lib/use-persistent-state";
import { Panel } from "@/components/ui/panel";
import { RecordPicker, recordSearchConfig } from "@/components/crm/record-picker";

/** Direction of the edge relative to the page (account) record. */
type LinkDirection = "owner-is-source" | "owner-is-target";

/**
 * When present, the table can CREATE a new contact whose PRIMARY account is
 * inherited (read-only) from this account page — creation context #2. The
 * contacts-list page is context #1 (account is an editable picker there).
 */
export interface ContactCreateContext {
  fields: FieldDefinitionWithLabels[];
  layoutConfig: LayoutConfig;
  accountId: string;
  accountName: string;
  locale: string;
}

interface ContactsTableProps {
  title: string;
  items: RelatedRecord[];
  /**
   * Contact field definitions — drive the DynamicTable's columns, sortable
   * headers, per-column filters and facets (mirrors the home-page list).
   */
  fields: FieldDefinitionWithLabels[];
  primaryAccountById: Record<string, { id: string; name: string }>;
  owningSegment: string;
  owningId: string;
  relationshipName: string;
  direction: LinkDirection;
  editPermission: string;
  canEdit: boolean;
  /** Enables the "New contact" create flow (the primary Contacts table only). */
  createContext?: ContactCreateContext;
  /**
   * Stable identifier for this table's user preferences (e.g. row count). When
   * given (with `storageScope`), the chosen row count persists per user across
   * logins via localStorage. Omit to keep the setting in-memory only.
   */
  persistKey?: string;
  /** Per-user namespace for persisted prefs (the current user's id). */
  storageScope?: string;
}

/**
 * Default / bounds for the user-adjustable row count. The count sets the
 * minimum banded height of the table (and therefore the panel size) — more
 * contacts than this still all render (page scroll); fewer pad with banding.
 */
const DEFAULT_TABLE_ROWS = 8;
const MIN_TABLE_ROWS = 3;
const MAX_TABLE_ROWS = 50;

/** The home-page contact columns we surface by default (when present in `fields`). */
const DEFAULT_CONTACT_COLUMNS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "status",
];

const TEXT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "long_text",
  "email",
  "phone",
  "url",
]);

/** Stable string view of a stored value, mirroring `data ->> slug` semantics. */
function asScalarString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/**
 * Client-side mirror of {@link buildFilterCondition} in `lib/crm/query.ts`.
 * Returns whether `record` satisfies `filter` for `field`. Unknown
 * operator/type combinations fall through to `true` (no-op), matching the
 * server's "ineligible filter is dropped" behaviour at the call site.
 */
function recordMatchesFilter(
  field: FieldDefinitionWithLabels,
  filter: Filter,
  data: Record<string, unknown>
): boolean {
  const ft = field.fieldType;
  const op = filter.operator;
  const v = filter.value;

  if (TEXT_TYPES.has(ft)) {
    const cell = (asScalarString(data[field.slug]) ?? "").toLowerCase();
    if (typeof v !== "string") return true;
    const needle = v.toLowerCase();
    if (op === "contains") return cell.includes(needle);
    if (op === "equals") return cell === needle;
    if (op === "startsWith") return cell.startsWith(needle);
    return true;
  }

  if (ft === "select") {
    const cell = asScalarString(data[field.slug]);
    if (typeof v !== "string") return true;
    if (op === "is") return cell === v;
    if (op === "isNot") return cell !== v;
    return true;
  }

  if (ft === "number" || ft === "currency") {
    const raw =
      ft === "currency"
        ? (data[field.slug] as { amount?: unknown } | null)?.amount
        : data[field.slug];
    const n = raw == null ? NaN : Number(raw);
    if (op === "equals") return Number.isFinite(n) && n === Number(v);
    if (op === "gt") return Number.isFinite(n) && n > Number(v);
    if (op === "lt") return Number.isFinite(n) && n < Number(v);
    if (op === "between" && Array.isArray(v)) {
      const lo = Number(v[0]);
      const hi = Number(v[1]);
      return Number.isFinite(n) && n >= lo && n <= hi;
    }
    return true;
  }

  if (ft === "date" || ft === "datetime") {
    const cellStr = asScalarString(data[field.slug]);
    const cell = cellStr ? Date.parse(cellStr) : NaN;
    if (!Number.isFinite(cell)) return false;
    if ((op === "before" || op === "after") && typeof v === "string") {
      const bound = Date.parse(v);
      if (!Number.isFinite(bound)) return true;
      return op === "before" ? cell < bound : cell > bound;
    }
    if (op === "between" && Array.isArray(v)) {
      const lo = Date.parse(v[0]);
      const hi = Date.parse(v[1]);
      return cell >= lo && cell <= hi;
    }
    return true;
  }

  if (ft === "boolean") {
    const cell = data[field.slug];
    const b = cell === true || cell === "true";
    if (op === "isTrue") return b;
    if (op === "isFalse") return !b;
    return true;
  }

  if (ft === "multi_select") {
    const arr = Array.isArray(data[field.slug])
      ? (data[field.slug] as unknown[]).map(String)
      : [];
    if (typeof v !== "string") return true;
    if (op === "has") return arr.includes(v);
    if (op === "hasNot") return !arr.includes(v);
    return true;
  }

  return true;
}

/** Comparable value for sorting, mirroring the server's per-type cast. */
function sortValue(
  field: FieldDefinitionWithLabels,
  data: Record<string, unknown>
): string | number | null {
  const ft = field.fieldType;
  if (ft === "number" || ft === "currency") {
    const raw =
      ft === "currency"
        ? (data[field.slug] as { amount?: unknown } | null)?.amount
        : data[field.slug];
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (ft === "date" || ft === "datetime") {
    const s = asScalarString(data[field.slug]);
    const t = s ? Date.parse(s) : NaN;
    return Number.isFinite(t) ? t : null;
  }
  if (ft === "boolean") {
    const cell = data[field.slug];
    if (cell === true || cell === "true") return 1;
    if (cell === false || cell === "false") return 0;
    return null;
  }
  return asScalarString(data[field.slug]);
}

export function ContactsTable({
  title,
  items,
  // Runtime-defaulted to [] so the component degrades gracefully before the
  // detail client wires `fields`; the prop stays required on the type so the
  // wiring site is surfaced by the typechecker.
  fields = [],
  // `primaryAccountById` is retained on the prop contract for drop-in
  // compatibility, but the shared DynamicTable renders the account via its
  // own field column rather than a bespoke cell, so it is no longer read here.
  owningSegment,
  owningId,
  relationshipName,
  direction,
  editPermission,
  canEdit,
  createContext,
  persistKey,
  storageScope,
}: ContactsTableProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Client-side table state — there is no server round-trip: the related
  // contacts are already in memory, so sort/filter run locally (mirroring the
  // server semantics in lib/crm/query.ts so behaviour matches the list page).
  const [sort, setSort] = useState<SortState | null>(null);
  const [filterState, setFilterState] = useState<FilterState>({
    filters: [],
    includeArchived: false,
  });

  const contactSegment = crmCollectionSegment("contact") ?? "contacts";

  const fieldBySlug = useMemo(
    () => new Map(fields.map((f) => [f.slug, f])),
    [fields]
  );

  // Archived (inactive) rows are hidden unless "Include archived" is on. The
  // control lives in the panel header (see below); contacts are never deleted,
  // only marked inactive.
  const includeArchived = filterState.includeArchived;

  const inactiveCount = useMemo(
    () => items.filter((r) => r.isArchived).length,
    [items]
  );

  // items → DynamicTableRecord (RelatedRecord already carries id/data/isArchived).
  const allRecords = useMemo<DynamicTableRecord[]>(
    () =>
      items.map((r) => ({
        id: r.id,
        data: r.data,
        isArchived: r.isArchived,
      })),
    [items]
  );

  // Apply: archived gate → column filters → sort.
  const displayed = useMemo<DynamicTableRecord[]>(() => {
    let rows = includeArchived
      ? allRecords
      : allRecords.filter((r) => !r.isArchived);

    for (const filter of filterState.filters) {
      const field = fieldBySlug.get(filter.fieldSlug);
      if (!field) continue;
      const eligible = operatorsForType(field.fieldType).some(
        (o) => o.value === filter.operator
      );
      if (!eligible) continue;
      rows = rows.filter((r) => recordMatchesFilter(field, filter, r.data));
    }

    if (sort) {
      const field = fieldBySlug.get(sort.fieldSlug);
      if (field && isSortable(field.fieldType)) {
        const dir = sort.direction === "desc" ? -1 : 1;
        rows = [...rows].sort((a, b) => {
          const av = sortValue(field, a.data);
          const bv = sortValue(field, b.data);
          // NULLs last regardless of direction (matches `nulls last`).
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          let cmp: number;
          if (typeof av === "number" && typeof bv === "number") {
            cmp = av - bv;
          } else {
            cmp = String(av).localeCompare(String(bv));
          }
          return cmp * dir;
        });
      }
    }

    return rows;
  }, [allRecords, includeArchived, filterState.filters, sort, fieldBySlug]);

  // Per-column facets — mirror loadCrmListData's eligibility rule, computed
  // over the BASE domain (archived gate only, ignoring active column filters).
  const columnFacets = useMemo<Record<string, string[]>>(() => {
    const baseRows = includeArchived
      ? allRecords
      : allRecords.filter((r) => !r.isArchived);

    const facets: Record<string, string[]> = {};
    for (const field of fields) {
      const isSelect = field.fieldType === "select";
      if (!isTextFilterable(field.fieldType) && !isSelect) continue;

      const counts = new Map<string, number>();
      for (const r of baseRows) {
        const val = asScalarString(r.data[field.slug]);
        if (val === null || val === "") continue;
        counts.set(val, (counts.get(val) ?? 0) + 1);
      }

      const distinct = [...counts.keys()];
      const eligible = isSelect
        ? distinct.length >= 1
        : distinct.length >= 2 && [...counts.values()].some((c) => c >= 2);
      if (eligible) {
        facets[field.slug] = distinct.sort((a, b) => a.localeCompare(b));
      }
    }
    return facets;
  }, [allRecords, fields, includeArchived]);

  const defaultVisibleColumns = useMemo(
    () =>
      DEFAULT_CONTACT_COLUMNS.filter((slug) => fieldBySlug.has(slug)),
    [fieldBySlug]
  );

  // Column visibility is controlled here so the "Columns" picker can sit in the
  // panel header (the DynamicTable's own toolbar is hidden — see hideToolbar).
  const orderedFields = useMemo(
    () => [...fields].sort((a, b) => a.displayOrder - b.displayOrder),
    [fields]
  );
  const [visibleColumns, setVisibleColumns] =
    useState<string[]>(defaultVisibleColumns);

  // User-controlled row count → drives the table's minimum banded height, so
  // the user effectively resizes the panel by the number of rows shown. The
  // choice persists per user across logins (localStorage) when a persistKey is
  // given; otherwise it's in-memory only.
  const rowCountKey =
    persistKey != null
      ? `adserve:crm:rowCount:${storageScope ?? "anon"}:${persistKey}`
      : null;
  const [rowCount, setRowCount] = usePersistentState<number>(
    rowCountKey,
    DEFAULT_TABLE_ROWS,
    (v): v is number =>
      typeof v === "number" &&
      Number.isInteger(v) &&
      v >= MIN_TABLE_ROWS &&
      v <= MAX_TABLE_ROWS
  );
  const stepRows = (delta: number) =>
    setRowCount((n) =>
      Math.min(MAX_TABLE_ROWS, Math.max(MIN_TABLE_ROWS, n + delta))
    );

  const locale = createContext?.locale ?? "en-GB";

  const excludeIds = useMemo(() => items.map((i) => i.id), [items]);
  const pickerCfg = useMemo(() => recordSearchConfig("contact"), []);

  // The create form omits the `account` relationship field (it's inherited +
  // shown read-only); everything else of the contact form is reused.
  const createFormFields = useMemo(
    () =>
      (createContext?.fields ?? []).filter(
        (f) => f.fieldType !== "relationship"
      ),
    [createContext]
  );

  async function callLink(method: "POST" | "DELETE", contactId: string) {
    const scopedSegment =
      direction === "owner-is-source" ? owningSegment : contactSegment;
    const scopedId = direction === "owner-is-source" ? owningId : contactId;
    const targetRecordId =
      direction === "owner-is-source" ? contactId : owningId;

    setError(null);
    const res = await fetch(
      `/api/crm/${scopedSegment}/${scopedId}/relationships`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relationshipName, targetRecordId }),
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Action failed (${res.status})`);
      return;
    }
    router.refresh();
  }

  async function handleCreate(validated: Record<string, unknown>) {
    if (!createContext) return;
    setCreateError(null);
    // The primary account is inherited from this account page (read-only) →
    // routed as accountId; the contact + primary link are written atomically.
    const res = await fetch(`/api/crm/contacts/with-accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: validated, accountId: createContext.accountId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setCreateError(body.error ?? `Create failed (${res.status})`);
      return;
    }
    setCreating(false);
    router.refresh();
  }

  return (
    <Panel
      as="section"
      aria-label={title}
      title={title}
      denseHeader
      actions={
        <div className="flex items-center gap-3">
          {/* Table chrome lives in the header to reclaim the vertical space the
              standalone toolbar used to take. */}
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={filterState.includeArchived}
              onChange={(e) =>
                setFilterState((s) => ({
                  ...s,
                  includeArchived: e.target.checked,
                }))
              }
              className="h-3.5 w-3.5 rounded border-[var(--border)]"
            />
            Include archived{inactiveCount > 0 ? ` (${inactiveCount})` : ""}
          </label>
          <ColumnToggle
            fields={orderedFields}
            visible={visibleColumns}
            onChange={setVisibleColumns}
            locale={locale}
          />
          {/* Row-count stepper: resizes the panel by the number of rows shown. */}
          <div
            className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]"
            role="group"
            aria-label="Rows shown"
          >
            <span>Rows</span>
            <button
              type="button"
              aria-label="Fewer rows"
              onClick={() => stepRows(-1)}
              disabled={rowCount <= MIN_TABLE_ROWS}
              className="flex h-5 w-5 items-center justify-center rounded border border-[var(--border)] leading-none hover:bg-[var(--muted)] disabled:opacity-40"
            >
              −
            </button>
            <span className="w-5 text-center tabular-nums text-[var(--foreground)]">
              {rowCount}
            </span>
            <button
              type="button"
              aria-label="More rows"
              onClick={() => stepRows(1)}
              disabled={rowCount >= MAX_TABLE_ROWS}
              className="flex h-5 w-5 items-center justify-center rounded border border-[var(--border)] leading-none hover:bg-[var(--muted)] disabled:opacity-40"
            >
              +
            </button>
          </div>
          {canEdit && createContext ? (
            // Primary Contacts table: create a NEW contact (account inherited).
            <PermissionGate permission="contact.create">
              <button
                type="button"
                onClick={() => {
                  setCreateError(null);
                  setCreating(true);
                }}
                className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] hover:brightness-95"
              >
                New contact
              </button>
            </PermissionGate>
          ) : null}
          {canEdit && !createContext ? (
            // Linked Contacts table: attach an EXISTING contact to this account.
            <PermissionGate permission={editPermission}>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setAdding((v) => !v);
                }}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--muted)]"
              >
                {adding ? "Cancel" : "Link existing contact"}
              </button>
            </PermissionGate>
          ) : null}
        </div>
      }
    >
      {error ? (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {adding && canEdit ? (
        <PermissionGate permission={editPermission}>
          <div className="mt-3">
            <RecordPicker
              value={null}
              onChange={(sel) => {
                if (sel?.kind === "existing") {
                  void callLink("POST", sel.id);
                  setAdding(false);
                }
              }}
              entitySegment={pickerCfg.entitySegment}
              searchFieldSlug={pickerCfg.searchFieldSlug}
              placeholder={pickerCfg.placeholder}
              labelOf={pickerCfg.labelOf}
              allowCreate={false}
              excludeIds={excludeIds}
            />
          </div>
        </PermissionGate>
      ) : null}

      <div className="mt-3">
        <DynamicTable
          fields={fields}
          records={displayed}
          sort={sort}
          onSortChange={setSort}
          filterState={filterState}
          onFiltersChange={setFilterState}
          pagination={{
            offset: 0,
            limit: Math.max(1, items.length),
            total: displayed.length,
          }}
          onPageChange={() => {}}
          onRowClick={(record) =>
            router.push(`/crm/${contactSegment}/${record.id}`)
          }
          visibleColumns={visibleColumns}
          onVisibleColumnsChange={setVisibleColumns}
          columnFacets={columnFacets}
          locale={locale}
          emptyMessage={
            inactiveCount > 0 && !includeArchived
              ? "No active contacts — tick “Include archived” to see inactive ones."
              : "No contacts here yet."
          }
          hideToolbar
          hidePagination
          dense
          minRows={rowCount}
        />
      </div>

      {/* Create-new-contact modal (account-inherited, read-only account). */}
      {creating && createContext ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setCreating(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-[var(--panel-bg)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">New contact</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setCreating(false)}
                className="rounded-md px-2 py-1 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
              >
                ✕
              </button>
            </div>

            {/* Account is inherited from this page → read-only. */}
            <div className="mt-4 flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">
                Account
              </span>
              <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm">
                {createContext.accountName}
              </div>
            </div>

            <div className="mt-4">
              <DynamicForm
                layoutConfig={createContext.layoutConfig}
                fields={createFormFields}
                initialData={null}
                mode="create"
                onSubmit={handleCreate}
                submitError={createError}
                submitLabel="Create contact"
                locale={createContext.locale}
              />
            </div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
