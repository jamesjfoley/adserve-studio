"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { crmCollectionSegment } from "@adserve/crm/url";
import type { RelatedRecord } from "@/lib/crm/relationships";
import { PermissionGate } from "@/lib/permissions-client";
import { Panel } from "@/components/ui/panel";
import { LinkRecordPicker } from "./link-record-picker";

/** Direction of the edge relative to the page (account) record. */
type LinkDirection = "owner-is-source" | "owner-is-target";

interface ContactsTableProps {
  /** Panel heading, e.g. "Contacts" or "Linked Contacts". */
  title: string;
  /** The contacts to list (already filtered to one relationship). */
  items: RelatedRecord[];
  /** Each contact's PRIMARY account, for the Account column. */
  primaryAccountById: Record<string, { id: string; name: string }>;
  /** The owning (account) page record's segment + id. */
  owningSegment: string;
  owningId: string;
  /** The relationship connecting account ↔ contact for add/remove. */
  relationshipName: string;
  direction: LinkDirection;
  editPermission: string;
  canEdit: boolean;
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

/**
 * A contact list rendered as a table (Name · Title · Account · Email ·
 * Telephone · LinkedIn) with add/remove, used by the account detail's single
 * "Contacts" tab for both the primary ("Contacts") and related ("Linked
 * Contacts") panels. Add/remove call the WS2 link route (source-scoped); the
 * server is the real authority (incl. the no-self-overlap rule).
 */
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
}: ContactsTableProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const contactSegment = crmCollectionSegment("contact") ?? "contacts";
  const accountSegment = crmCollectionSegment("account") ?? "accounts";
  const sorted = useMemo(
    () => [...items].sort((a, b) => contactName(a).localeCompare(contactName(b))),
    [items]
  );
  const excludeIds = useMemo(() => items.map((i) => i.id), [items]);

  async function callLink(method: "POST" | "DELETE", contactId: string) {
    // contact_related_to_account / contact_belongs_to_account are scoped to the
    // CONTACT as source. From the account page the owning record is the target,
    // so scope the call to the contact and pass the account as target.
    const scopedSegment =
      direction === "owner-is-source" ? owningSegment : contactSegment;
    const scopedId = direction === "owner-is-source" ? owningId : contactId;
    const targetRecordId =
      direction === "owner-is-source" ? contactId : owningId;

    setError(null);
    setBusyId(contactId);
    try {
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
    } finally {
      setBusyId(null);
    }
  }

  const cellClass = "px-3 py-2 text-sm align-top";
  const headClass =
    "px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]";

  return (
    <Panel
      as="section"
      aria-label={title}
      title={title}
      actions={
        canEdit ? (
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
        ) : null
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
            <LinkRecordPicker
              relatedSlug="contact"
              excludeIds={excludeIds}
              onPick={async (id) => {
                await callLink("POST", id);
                setAdding(false);
              }}
            />
          </div>
        </PermissionGate>
      ) : null}

      {sorted.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          No contacts here yet.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className={headClass}>Name</th>
                <th className={headClass}>Title</th>
                <th className={headClass}>Account</th>
                <th className={headClass}>Email</th>
                <th className={headClass}>Telephone</th>
                <th className={headClass}>LinkedIn</th>
                {canEdit ? <th className={headClass} /> : null}
              </tr>
            </thead>
            <tbody>
              {sorted.map((rec) => {
                const primary = primaryAccountById[rec.id];
                const email = str(rec.data, "email");
                const phone = str(rec.data, "phone");
                const linkedin = str(rec.data, "linkedinUrl");
                return (
                  <tr
                    key={rec.id}
                    className="border-b border-[var(--border)] last:border-0"
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
                    {canEdit ? (
                      <td className={`${cellClass} text-right`}>
                        <PermissionGate permission={editPermission}>
                          <button
                            type="button"
                            disabled={busyId === rec.id}
                            onClick={() => callLink("DELETE", rec.id)}
                            className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </PermissionGate>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
