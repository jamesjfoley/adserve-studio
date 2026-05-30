"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type {
  FieldDefinitionWithLabels,
  LayoutConfig,
} from "@adserve/module-framework";
import { crmCollectionSegment, type CrmActivityType } from "@adserve/crm";
import { DynamicForm } from "@/components/dynamic-form";
import type { SerializedRecord } from "@/lib/crm/serialize";
import type { SerializedActivity } from "../page";
import { AiActivitySummary } from "./ai-activity-summary";

interface CrmDetailClientProps {
  collectionSegment: string;
  entityName: string;
  recordId: string;
  title: string;
  record: SerializedRecord;
  fields: FieldDefinitionWithLabels[];
  layoutConfig: LayoutConfig;
  relationships: Record<string, SerializedRecord[]>;
  activities: SerializedActivity[];
  canEdit: boolean;
  canArchive: boolean;
  canConvert: boolean;
  canLogActivity: boolean;
  canViewActivities: boolean;
  /** Task 1.7c — show the "Summarize recent activity" AI affordance (accounts). */
  showAiSummary?: boolean;
  locale: string;
}

const ACTIVITY_TYPES: CrmActivityType[] = [
  "call",
  "email",
  "meeting",
  "task",
  "note",
];

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Best-effort human label for a related record, presentation-only. */
function relatedLabel(rec: SerializedRecord): string {
  const d = rec.data;
  if (typeof d.name === "string" && d.name.trim() !== "") return d.name;
  const fn = typeof d.firstName === "string" ? d.firstName : "";
  const ln = typeof d.lastName === "string" ? d.lastName : "";
  const full = `${fn} ${ln}`.trim();
  return full !== "" ? full : rec.id;
}

export function CrmDetailClient({
  collectionSegment,
  entityName,
  recordId,
  title,
  record,
  fields,
  layoutConfig,
  relationships,
  activities,
  canEdit,
  canArchive,
  canConvert,
  canLogActivity,
  canViewActivities,
  showAiSummary = false,
  locale,
}: CrmDetailClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [editError, setEditError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale]
  );

  const isConverted = record.data.status === "converted";
  const showConvert = canConvert && !isConverted;

  async function handleSave(validated: Record<string, unknown>) {
    setEditError(null);
    const res = await fetch(`/api/crm/${collectionSegment}/${recordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: validated }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setEditError(body.error ?? `Save failed (${res.status})`);
      return;
    }
    setMode("view");
    startTransition(() => router.refresh());
  }

  async function handleArchive() {
    setActionError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/${collectionSegment}/${recordId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? `Archive failed (${res.status})`);
        return;
      }
      startTransition(() => router.push(`/crm/${collectionSegment}`));
    } finally {
      setBusy(false);
    }
  }

  async function handleConvert() {
    setActionError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/leads/${recordId}/convert`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(
          res.status === 409
            ? body.error ?? "Lead is already converted"
            : body.error ?? `Convert failed (${res.status})`
        );
        return;
      }
      // 201 → navigate to the new account detail page.
      const accountId = body.account?.id as string | undefined;
      const accountsSegment = crmCollectionSegment("account") ?? "accounts";
      startTransition(() =>
        router.push(
          accountId ? `/crm/${accountsSegment}/${accountId}` : `/crm/leads`
        )
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleLogActivity(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLogError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const activityType = String(fd.get("activityType") ?? "note");
    const subject = String(fd.get("subject") ?? "").trim();
    const text = String(fd.get("text") ?? "").trim();
    // Due date only applies to task-type activities; stored day-granular
    // (YYYY-MM-DD) in metadata.dueDate — the dashboard's upcoming widget.
    const dueDate = String(fd.get("dueDate") ?? "").trim();
    const metadata =
      activityType === "task" && dueDate ? { dueDate } : undefined;

    const res = await fetch(`/api/crm/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recordId,
        activityType,
        subject: subject || null,
        body: text ? { text } : {},
        ...(metadata ? { metadata } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setLogError(body.error ?? `Log failed (${res.status})`);
      return;
    }
    setLogOpen(false);
    startTransition(() => router.refresh());
  }

  const relationshipSlugs = Object.keys(relationships).sort();

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
            {entityName}
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {title}
            {record.isArchived ? (
              <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs font-medium text-[var(--muted-foreground)]">
                Archived
              </span>
            ) : null}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {canLogActivity ? (
            <button
              type="button"
              onClick={() => {
                setLogError(null);
                setLogOpen(true);
              }}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)]"
            >
              Log activity
            </button>
          ) : null}
          {showConvert ? (
            <button
              type="button"
              onClick={handleConvert}
              disabled={busy}
              className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              Convert lead
            </button>
          ) : null}
          {canEdit && mode === "view" ? (
            <button
              type="button"
              onClick={() => {
                setEditError(null);
                setMode("edit");
              }}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)]"
            >
              Edit
            </button>
          ) : null}
          {canArchive && !record.isArchived ? (
            <button
              type="button"
              onClick={handleArchive}
              disabled={busy}
              className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Archive
            </button>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {actionError}
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Main form */}
        <div className="lg:col-span-2">
          <DynamicForm
            key={mode}
            layoutConfig={layoutConfig}
            fields={fields}
            initialData={record.data}
            mode={mode}
            onSubmit={mode === "edit" ? handleSave : undefined}
            submitError={editError}
            submitLabel="Save changes"
            locale={locale}
          />
          {mode === "edit" ? (
            <button
              type="button"
              onClick={() => {
                setEditError(null);
                setMode("view");
              }}
              className="mt-2 text-sm text-[var(--muted-foreground)] hover:underline"
            >
              Cancel
            </button>
          ) : null}
        </div>

        {/* Sidebar */}
        <aside className="space-y-6">
          {/* Related records */}
          <section>
            <h2 className="text-sm font-semibold tracking-tight">Related</h2>
            {relationshipSlugs.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                No related records.
              </p>
            ) : (
              relationshipSlugs.map((relSlug) => {
                const segment = crmCollectionSegment(relSlug) ?? relSlug;
                return (
                  <div key={relSlug} className="mt-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                      {titleCase(relSlug)}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {relationships[relSlug].map((rec) => (
                        <li key={rec.id}>
                          <a
                            href={`/crm/${segment}/${rec.id}`}
                            className={
                              rec.isArchived
                                ? "text-sm text-[var(--muted-foreground)] line-through hover:underline"
                                : "text-sm text-brand-600 hover:underline"
                            }
                          >
                            {relatedLabel(rec)}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </section>

          {/* Activity timeline */}
          {canViewActivities ? (
            <section aria-label="Activity timeline">
              <h2 className="text-sm font-semibold tracking-tight">Activity</h2>
              {showAiSummary ? (
                <AiActivitySummary accountId={recordId} />
              ) : null}
              {activities.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                  No activity yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {activities.map((a) => {
                    const text =
                      typeof a.body.text === "string" ? a.body.text : "";
                    return (
                      <li
                        key={a.id}
                        className="border-l-2 border-[var(--border)] pl-3"
                      >
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs font-medium">
                            {titleCase(a.activityType)}
                          </span>
                          <time className="text-xs text-[var(--muted-foreground)]">
                            {dateFmt.format(new Date(a.createdAt))}
                          </time>
                        </div>
                        {a.subject ? (
                          <p className="mt-1 text-sm font-medium">{a.subject}</p>
                        ) : null}
                        {text ? (
                          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                            {text}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}
        </aside>
      </div>

      {/* Log activity modal */}
      {logOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setLogOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-[var(--background)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">
                Log activity
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setLogOpen(false)}
                className="rounded-md px-2 py-1 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
              >
                ✕
              </button>
            </div>
            <form className="mt-4 space-y-3" onSubmit={handleLogActivity}>
              <label className="block text-sm">
                <span className="font-medium">Type</span>
                <select
                  name="activityType"
                  defaultValue="note"
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  {ACTIVITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {titleCase(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium">Subject</span>
                <input
                  name="subject"
                  type="text"
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Notes</span>
                <textarea
                  name="text"
                  rows={3}
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Due date</span>
                <span className="ml-1 text-xs text-[var(--muted-foreground)]">
                  (tasks only)
                </span>
                <input
                  name="dueDate"
                  type="date"
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              {logError ? (
                <p className="text-sm text-red-600" role="alert">
                  {logError}
                </p>
              ) : null}
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
                >
                  Save activity
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
