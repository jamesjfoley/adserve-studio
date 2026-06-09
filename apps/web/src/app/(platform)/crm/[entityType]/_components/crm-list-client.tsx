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
import { Panel } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";
import type { AccountSelection } from "@/components/crm/account-picker";

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
   * When true (the contact list), create routes through the combined
   * contacts/with-accounts endpoint so the contact + its account link are
   * written atomically. The account itself renders inline as a normal
   * relationship field (the `account` field def), placed via the layout editor.
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
    // The `account` relationship is rendered inline by the form (an
    // AccountSelection), but it isn't a records.data field — pull it out and
    // route it as accountId/newAccountName so the contact + its account link
    // are written atomically by the combined endpoint (all-or-nothing).
    const sel = (validated.account as AccountSelection | null | undefined) ?? null;
    delete validated.account;
    const accountBody =
      sel?.kind === "existing"
        ? { accountId: sel.id }
        : sel?.kind === "new"
          ? { newAccountName: sel.name }
          : {};
    // `reportsTo` (manager) is a relationship field too — route it to the
    // reportsTo directive (existing contact only).
    const mgr = (validated.reportsTo as AccountSelection | null | undefined) ?? null;
    const hasReportsTo = "reportsTo" in validated;
    delete validated.reportsTo;
    const reportsToBody =
      hasReportsTo && mgr?.kind === "existing"
        ? { reportsTo: { contactId: mgr.id } }
        : {};
    const res = enableAccountPicker
      ? await fetch(`/api/crm/contacts/with-accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: validated, ...accountBody, ...reportsToBody }),
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

  const countLabel = `${pagination.total} ${
    pagination.total === 1
      ? entityName.toLowerCase()
      : `${entityName.toLowerCase()}s`
  }`;

  return (
    <div>
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
              onClick={() => {
                setCreateError(null);
                setNewOpen(true);
              }}
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

      <Panel className="mt-6">
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
      </Panel>

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
