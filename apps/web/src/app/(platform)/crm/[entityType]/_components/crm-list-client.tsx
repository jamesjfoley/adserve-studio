"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FieldDefinitionWithLabels } from "@adserve/module-framework";
import { DynamicTable } from "@/components/dynamic-table";
import type {
  DynamicTableRecord,
  FilterState,
  PaginationState,
  SortState,
} from "@/components/dynamic-table";
import { stateToQuery, type ListState } from "@/lib/crm/list-params";
import { usePersistentState } from "@/lib/use-persistent-state";
import type { TenantMember } from "@/lib/crm/members";
import { Panel } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";

interface Choice {
  value: string;
  label: string;
}

interface CrmListClientProps {
  collectionSegment: string;
  entityName: string;
  fields: FieldDefinitionWithLabels[];
  records: DynamicTableRecord[];
  defaultVisibleColumns: string[];
  sort: SortState | null;
  filterState: FilterState;
  pagination: PaginationState;
  members: TenantMember[];
  owner?: string | null;
  /** Per-column distinct values for the header value-picker (text columns). */
  columnFacets?: Record<string, string[]>;
  /** Entity slug + current user — namespace the persisted column prefs. */
  entitySlug: string;
  userId?: string;
  locale: string;
}

/** Per-user, per-entity column preferences (persisted across logins). */
interface ColumnPrefs {
  visible?: string[];
  order?: string[];
  widths?: Record<string, number>;
}

function titleCase(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

/** The single-select field bulk "change status" targets, if any. */
function findStatusField(
  fields: FieldDefinitionWithLabels[]
): FieldDefinitionWithLabels | null {
  const selects = fields.filter((f) => f.fieldType === "select");
  return (
    selects.find((f) => f.slug === "status") ??
    selects.find((f) => f.slug === "stage") ??
    selects[0] ??
    null
  );
}

function choicesOf(field: FieldDefinitionWithLabels | null): Choice[] {
  const opts = (field?.options as { choices?: Choice[] }) ?? {};
  return Array.isArray(opts.choices) ? opts.choices : [];
}

/**
 * The field the home-page search box filters on (a `contains` match). Prefer
 * the record's display name, then a person's first name, then the first
 * free-text column — so search always targets something meaningful.
 */
function findSearchField(
  fields: FieldDefinitionWithLabels[]
): FieldDefinitionWithLabels | null {
  return (
    fields.find((f) => f.slug === "name") ??
    fields.find((f) => f.slug === "firstName") ??
    fields.find((f) => f.fieldType === "text" || f.fieldType === "long_text") ??
    null
  );
}

export function CrmListClient({
  collectionSegment,
  entityName,
  fields,
  records,
  defaultVisibleColumns,
  sort,
  filterState,
  pagination,
  members,
  owner,
  columnFacets,
  entitySlug,
  userId,
  locale,
}: CrmListClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Persisted column layout (visibility, order, widths) per user + entity.
  const [columnPrefs, setColumnPrefs] = usePersistentState<ColumnPrefs>(
    userId ? `adserve:crm:columns:${userId}:${entitySlug}` : null,
    {},
    (v): v is ColumnPrefs => typeof v === "object" && v !== null
  );
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const statusField = findStatusField(fields);
  const statusChoices = choicesOf(statusField);
  const searchField = findSearchField(fields);

  const current: ListState = {
    offset: pagination.offset,
    limit: pagination.limit,
    includeArchived: filterState.includeArchived,
    sort,
    filters: filterState.filters,
    owner: owner ?? null,
  };

  function navigate(next: ListState) {
    const qs = stateToQuery(next);
    startTransition(() =>
      router.push(`/crm/${collectionSegment}${qs ? `?${qs}` : ""}`)
    );
  }

  function handleSortChange(nextSort: SortState | null) {
    navigate({ ...current, sort: nextSort, offset: 0 });
  }
  function handleFiltersChange(next: FilterState) {
    navigate({
      ...current,
      filters: next.filters,
      includeArchived: next.includeArchived,
      offset: 0,
    });
  }
  function handlePageChange(nextOffset: number) {
    navigate({ ...current, offset: nextOffset });
  }
  function handleOwnerChange(nextOwner: string) {
    navigate({ ...current, owner: nextOwner || null, offset: 0 });
  }
  function handleRowClick(record: DynamicTableRecord) {
    startTransition(() =>
      router.push(`/crm/${collectionSegment}/${record.id}`)
    );
  }

  async function runBulk(payload: Record<string, unknown>) {
    setBulkError(null);
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/crm/${collectionSegment}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, recordIds: selectedIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setBulkError(body.error ?? `Bulk action failed (${res.status})`);
        return;
      }
      setSelectedIds([]);
      startTransition(() => router.refresh());
    } finally {
      setBulkBusy(false);
    }
  }

  const countLabel = `${pagination.total} ${
    pagination.total === 1
      ? entityName.toLowerCase()
      : `${entityName.toLowerCase()}s`
  }`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={titleCase(collectionSegment)}
        subtitle={countLabel}
        actions={
          <>
            <label className="text-sm">
              <span className="sr-only">Filter by owner</span>
              <select
                aria-label="Filter by owner"
                value={owner ?? ""}
                onChange={(e) => handleOwnerChange(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-sm"
              >
                <option value="">All owners</option>
                <option value="me">My records</option>
                <option value="unassigned">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() =>
                startTransition(() =>
                  router.push(`/crm/${collectionSegment}/new`)
                )
              }
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:brightness-95"
            >
              New {entityName.toLowerCase()}
            </button>
          </>
        }
      />

      {/* Bulk action bar — visible only with a selection */}
      {selectedIds.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-4 py-3">
          <span className="text-sm font-medium">
            {selectedIds.length} selected
          </span>

          <label className="text-sm">
            <span className="sr-only">Assign owner</span>
            <select
              aria-label="Assign owner"
              value=""
              disabled={bulkBusy}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                runBulk({
                  action: "assignOwner",
                  ownedBy: v === "__unassign__" ? null : v,
                });
                e.target.value = "";
              }}
              className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-sm"
            >
              <option value="">Assign owner…</option>
              <option value="__unassign__">Unassign</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
          </label>

          {statusField && statusChoices.length > 0 ? (
            <label className="text-sm">
              <span className="sr-only">Change {statusField.name}</span>
              <select
                aria-label={`Change ${statusField.name}`}
                value=""
                disabled={bulkBusy}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  runBulk({
                    action: "changeStatus",
                    field: statusField.slug,
                    value: v,
                  });
                  e.target.value = "";
                }}
                className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-sm"
              >
                <option value="">Change {statusField.name.toLowerCase()}…</option>
                {statusChoices.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => runBulk({ action: "archive" })}
            className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Archive
          </button>

          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="text-sm text-[var(--muted-foreground)] hover:underline"
          >
            Clear
          </button>

          {bulkError ? (
            <span className="text-sm text-red-600" role="alert">
              {bulkError}
            </span>
          ) : null}
        </div>
      ) : null}

      <Panel
        className="mt-4 flex min-h-0 flex-1 flex-col"
        bodyClassName="flex min-h-0 flex-1 flex-col"
      >
        <DynamicTable
          fields={fields}
          records={records}
          sort={sort}
          onSortChange={handleSortChange}
          filterState={filterState}
          onFiltersChange={handleFiltersChange}
          pagination={pagination}
          onPageChange={handlePageChange}
          onRowClick={handleRowClick}
          visibleColumns={columnPrefs.visible ?? defaultVisibleColumns}
          onVisibleColumnsChange={(visible) =>
            setColumnPrefs((p) => ({ ...p, visible }))
          }
          columnOrder={columnPrefs.order}
          onColumnOrderChange={(order) =>
            setColumnPrefs((p) => ({ ...p, order }))
          }
          columnWidths={columnPrefs.widths ?? {}}
          onColumnWidthsChange={(widths) =>
            setColumnPrefs((p) => ({ ...p, widths }))
          }
          defaultVisibleColumns={defaultVisibleColumns}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          locale={locale}
          emptyMessage={`No ${entityName.toLowerCase()}s yet.`}
          fillHeight
          searchField={searchField?.slug}
          searchPlaceholder={`Search ${entityName.toLowerCase()}s…`}
          columnFacets={columnFacets}
        />
      </Panel>
    </div>
  );
}
