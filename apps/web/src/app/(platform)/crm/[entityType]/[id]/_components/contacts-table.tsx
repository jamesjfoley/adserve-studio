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
import { PermissionGate } from "@/lib/permissions-client";
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
  primaryAccountById: Record<string, { id: string; name: string }>;
  owningSegment: string;
  owningId: string;
  relationshipName: string;
  direction: LinkDirection;
  editPermission: string;
  canEdit: boolean;
  /** Stretch the panel/table to fill the available column height. */
  fillHeight?: boolean;
  /** Enables the "New contact" create flow (the primary Contacts table only). */
  createContext?: ContactCreateContext;
}

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === "string" ? v : "";
}

function contactName(rec: RelatedRecord): string {
  const fn = str(rec.data, "firstName");
  const ln = str(rec.data, "lastName");
  const full = `${fn} ${ln}`.trim();
  if (full !== "") return full;
  const name = str(rec.data, "name");
  return name !== "" ? name : rec.id;
}

const EMPTY = "—";

export function ContactsTable({
  title,
  items,
  primaryAccountById,
  owningSegment,
  owningId,
  relationshipName,
  direction,
  editPermission,
  canEdit,
  fillHeight = false,
  createContext,
}: ContactsTableProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const contactSegment = crmCollectionSegment("contact") ?? "contacts";
  const accountSegment = crmCollectionSegment("account") ?? "accounts";
  const sorted = useMemo(
    () => [...items].sort((a, b) => contactName(a).localeCompare(contactName(b))),
    [items]
  );
  // Inactive (archived) contacts are hidden by default; the checkbox reveals
  // them. Contacts are never deleted — only marked inactive.
  const visible = useMemo(
    () => (showInactive ? sorted : sorted.filter((r) => !r.isArchived)),
    [sorted, showInactive]
  );
  const inactiveCount = useMemo(
    () => sorted.filter((r) => r.isArchived).length,
    [sorted]
  );
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

  const cellClass = "px-3 py-2 text-sm align-top";
  const headClass =
    "px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]";

  return (
    <Panel
      as="section"
      aria-label={title}
      title={title}
      className={fillHeight ? "flex min-h-0 flex-1 flex-col" : undefined}
      actions={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--border)]"
            />
            Show inactive{inactiveCount > 0 ? ` (${inactiveCount})` : ""}
          </label>
          {canEdit ? (
            <div className="flex items-center gap-2">
              {createContext ? (
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
              <PermissionGate permission={editPermission}>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setAdding((v) => !v);
                  }}
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--muted)]"
                >
                  {adding ? "Cancel" : "Add contact"}
                </button>
              </PermissionGate>
            </div>
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

      {visible.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          {inactiveCount > 0 && !showInactive
            ? "No active contacts — tick “Show inactive” to see inactive ones."
            : "No contacts here yet."}
        </p>
      ) : (
        <div
          className={
            fillHeight ? "mt-3 min-h-0 flex-1 overflow-auto" : "mt-3 overflow-x-auto"
          }
        >
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className={headClass}>Name</th>
                <th className={headClass}>Title</th>
                <th className={headClass}>Account</th>
                <th className={headClass}>Email</th>
                <th className={headClass}>Telephone</th>
                <th className={headClass}>LinkedIn</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((rec) => {
                const primary = primaryAccountById[rec.id];
                const email = str(rec.data, "email");
                const phone = str(rec.data, "phone");
                const linkedin = str(rec.data, "linkedinUrl");
                return (
                  <tr
                    key={rec.id}
                    className="border-b border-[var(--border)] last:border-0 even:bg-[color-mix(in_srgb,var(--muted)_55%,transparent)]"
                  >
                    <td className={cellClass}>
                      <a
                        href={`/crm/${contactSegment}/${rec.id}`}
                        className={
                          rec.isArchived
                            ? "text-[var(--muted-foreground)] line-through hover:underline"
                            : "text-[var(--accent)] hover:underline"
                        }
                      >
                        {contactName(rec)}
                      </a>
                    </td>
                    <td className={cellClass}>{str(rec.data, "title") || EMPTY}</td>
                    <td className={cellClass}>
                      {primary ? (
                        <a
                          href={`/crm/${accountSegment}/${primary.id}`}
                          className="text-[var(--accent)] hover:underline"
                        >
                          {primary.name}
                        </a>
                      ) : (
                        EMPTY
                      )}
                    </td>
                    <td className={cellClass}>
                      {email ? (
                        <a
                          href={`mailto:${email}`}
                          className="text-[var(--accent)] hover:underline"
                        >
                          {email}
                        </a>
                      ) : (
                        EMPTY
                      )}
                    </td>
                    <td className={cellClass}>{phone || EMPTY}</td>
                    <td className={cellClass}>
                      {linkedin ? (
                        <a
                          href={linkedin}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--accent)] hover:underline"
                        >
                          Profile
                        </a>
                      ) : (
                        EMPTY
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create-new-contact modal (account-inherited, read-only account). */}
      {creating && createContext ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setCreating(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-[var(--background)] p-6 shadow-xl"
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
