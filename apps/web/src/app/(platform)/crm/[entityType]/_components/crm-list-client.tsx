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
import type { TenantMember } from "@/lib/crm/members";
import { PermissionGate } from "@/lib/permissions-client";
import { AccountMultiSelect } from "./account-multi-select";

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
  createLayoutConfig: LayoutConfig;
  members: TenantMember[];
  owner?: string | null;
  /**
   * WS3 — when true (the contact list), the create modal shows an account
   * multi-select and routes create+link through the combined endpoint so the
   * contact + its account links are written atomically.
   */
  enableAccountPicker?: boolean;
  locale: string;
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
  members,
  owner,
  enableAccountPicker = false,
  locale,
}: CrmListClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [newOpen, setNewOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const statusField = findStatusField(fields);
  const statusChoices = choicesOf(statusField);

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

  async function handleCreate(validated: Record<string, unknown>) {
    setCreateError(null);
    // WS3 — the contact create flow posts to the combined endpoint so the
    // contact and its account links are written atomically (all-or-nothing).
    const res = enableAccountPicker
      ? await fetch(`/api/crm/contacts/with-accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: validated,
            accountIds: selectedAccountIds,
          }),
        })
      : await fetch(`/api/crm/${collectionSegment}`, {
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
    setSelectedAccountIds([]);
    startTransition(() => router.refresh());
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
        <div className="flex items-center gap-2">
          <label className="text-sm">
            <span className="sr-only">Filter by owner</span>
            <select
              aria-label="Filter by owner"
              value={owner ?? ""}
              onChange={(e) => handleOwnerChange(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
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
            onClick={() => {
              setCreateError(null);
              setSelectedAccountIds([]);
              setNewOpen(true);
            }}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            New {entityName.toLowerCase()}
          </button>
        </div>
      </div>

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
              className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
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
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
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
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
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
            <div className="mt-4 space-y-4">
              {enableAccountPicker ? (
                <PermissionGate permission="contact.create">
                  <AccountMultiSelect
                    selectedIds={selectedAccountIds}
                    onChange={setSelectedAccountIds}
                  />
                </PermissionGate>
              ) : null}
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
