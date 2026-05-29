"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  FieldDefinitionWithLabels,
  LayoutConfig,
} from "@adserve/module-framework";
import { DynamicTable } from "@/components/dynamic-table";
import type {
  DynamicTableRecord,
  FilterState,
  PaginationState,
  SortState,
} from "@/components/dynamic-table";
import { DynamicForm } from "@/components/dynamic-form";
import { stateToQuery, type ListState } from "@/lib/crm/list-params";

interface CrmListClientProps {
  collectionSegment: string;
  entityName: string;
  fields: FieldDefinitionWithLabels[];
  records: DynamicTableRecord[];
  defaultVisibleColumns: string[];
  sort: SortState | null;
  filterState: FilterState;
  pagination: PaginationState;
  createLayoutConfig: LayoutConfig;
  locale: string;
}

function titleCase(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1);
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
  createLayoutConfig,
  locale,
}: CrmListClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [newOpen, setNewOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const current: ListState = {
    offset: pagination.offset,
    limit: pagination.limit,
    includeArchived: filterState.includeArchived,
    sort,
    filters: filterState.filters,
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
  function handleRowClick(record: DynamicTableRecord) {
    startTransition(() =>
      router.push(`/crm/${collectionSegment}/${record.id}`)
    );
  }

  async function handleCreate(validated: Record<string, unknown>) {
    setCreateError(null);
    const res = await fetch(`/api/crm/${collectionSegment}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: validated }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setCreateError(body.error ?? `Create failed (${res.status})`);
      return;
    }
    setNewOpen(false);
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {titleCase(collectionSegment)}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {pagination.total} {pagination.total === 1 ? entityName.toLowerCase() : `${entityName.toLowerCase()}s`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreateError(null);
            setNewOpen(true);
          }}
          className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          New {entityName.toLowerCase()}
        </button>
      </div>

      <div className="mt-6">
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
          defaultVisibleColumns={defaultVisibleColumns}
          locale={locale}
          emptyMessage={`No ${entityName.toLowerCase()}s yet.`}
        />
      </div>

      {newOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setNewOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-[var(--background)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">
                New {entityName.toLowerCase()}
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setNewOpen(false)}
                className="rounded-md px-2 py-1 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
              >
                ✕
              </button>
            </div>
            <div className="mt-4">
              <DynamicForm
                layoutConfig={createLayoutConfig}
                fields={fields}
                initialData={null}
                mode="create"
                onSubmit={handleCreate}
                submitError={createError}
                submitLabel={`Create ${entityName.toLowerCase()}`}
                locale={locale}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
