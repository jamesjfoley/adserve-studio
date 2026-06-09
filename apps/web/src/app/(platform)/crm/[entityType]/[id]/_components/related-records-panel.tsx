"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { crmCollectionSegment } from "@adserve/crm/url";
import type { RelatedRecord } from "@/lib/crm/relationships";
import { PermissionGate } from "@/lib/permissions-client";
import { Panel } from "@/components/ui/panel";
import { RecordPicker, recordSearchConfig } from "@/components/crm/record-picker";

/** Best-effort human label for a related record, presentation-only. */
export function relatedLabel(rec: { id: string; data: Record<string, unknown> }): string {
  const d = rec.data;
  if (typeof d.name === "string" && d.name.trim() !== "") return d.name;
  const fn = typeof d.firstName === "string" ? d.firstName : "";
  const ln = typeof d.lastName === "string" ? d.lastName : "";
  const full = `${fn} ${ln}`.trim();
  return full !== "" ? full : rec.id;
}

/** Sort primary-linked records first, then by label for stability. */
function sortPrimaryFirst(items: RelatedRecord[]): RelatedRecord[] {
  return [...items].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return relatedLabel(a).localeCompare(relatedLabel(b));
  });
}

/**
 * The link API (WS2) is scoped to the SOURCE side of the relationship (the
 * route `[entityType]/[id]` record must be the source). This panel may be
 * rendered on either side of an edge, so `direction` says whether the owning
 * (page) record is the source or the target:
 *   - "owner-is-source": the page record is the source; the call is scoped to
 *     it and `targetRecordId` is the related record (e.g. opportunity→contacts).
 *   - "owner-is-target": the related record is the source; the call is scoped
 *     to the related record and `targetRecordId` is the page record
 *     (e.g. account managing its contacts via contact_belongs_to_account).
 */
type LinkDirection = "owner-is-source" | "owner-is-target";

interface RelatedRecordsPanelProps {
  /** The slug of the related entity shown here (e.g. "contact"). */
  relatedSlug: string;
  /** Plural label for the empty state, e.g. "contacts". */
  relatedPluralLabel: string;
  /** The owning (page) record's collection segment + id. */
  owningSegment: string;
  owningId: string;
  /** The relationship name connecting the two records. */
  relationshipName: string;
  /** Which side of the edge the owning (page) record sits on. */
  direction: LinkDirection;
  /** Related records (with edge metadata) for this tab. */
  items: RelatedRecord[];
  /**
   * Permission gating the editing controls cosmetically. This must mirror the
   * server's real rule: WS2 authorizes link/unlink on the SOURCE record's
   * `.update`-or-ownership, so callers pass the SOURCE slug's `.update` (e.g.
   * `contact.update` when an account manages its contacts), NOT `account.update`.
   * Server-side `canMutate` (incl. the ownership escape-hatch) is the real gate.
   */
  editPermission: string;
  /** Whether this relationship supports a "primary" marker (set-primary control). */
  supportsPrimary: boolean;
  /** Whether the user may edit (server still enforces). Drives control visibility. */
  canEdit: boolean;
}

/**
 * WS3 — a linked-records list for one relationship, with primary-first ordering,
 * a "Primary" badge, and add/remove/set-primary controls that call the WS2 link
 * API. Renders an explicit empty state when there are zero links. Structured as a
 * self-contained <section> so WS4 can swap the wrapper for a <Panel>.
 */
export function RelatedRecordsPanel({
  relatedSlug,
  relatedPluralLabel,
  owningSegment,
  owningId,
  relationshipName,
  direction,
  items,
  editPermission,
  supportsPrimary,
  canEdit,
}: RelatedRecordsPanelProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const segment = crmCollectionSegment(relatedSlug) ?? relatedSlug;
  const sorted = useMemo(() => sortPrimaryFirst(items), [items]);
  const pickerCfg = useMemo(() => recordSearchConfig(relatedSlug), [relatedSlug]);

  /**
   * Issue a WS2 link/unlink call for one related record. The route must be
   * scoped to the SOURCE side: when the owning (page) record is the source the
   * call is scoped to it and the related record is the target; when the owning
   * record is the target the call is scoped to the related record and the
   * owning record is the target id.
   */
  async function callLink(
    method: "POST" | "DELETE",
    relatedRecordId: string,
    isPrimary?: boolean
  ) {
    const scopedSegment =
      direction === "owner-is-source" ? owningSegment : segment;
    const scopedId = direction === "owner-is-source" ? owningId : relatedRecordId;
    const targetRecordId =
      direction === "owner-is-source" ? relatedRecordId : owningId;

    setError(null);
    setBusyId(relatedRecordId);
    try {
      const res = await fetch(
        `/api/crm/${scopedSegment}/${scopedId}/relationships`,
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            relationshipName,
            targetRecordId,
            ...(isPrimary ? { isPrimary: true } : {}),
          }),
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

  const excludeIds = useMemo(() => items.map((i) => i.id), [items]);

  return (
    <Panel
      as="section"
      aria-label={`Linked ${relatedPluralLabel}`}
      title={
        relatedPluralLabel.charAt(0).toUpperCase() + relatedPluralLabel.slice(1)
      }
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
              {adding ? "Cancel" : `Add ${relatedSlug}`}
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

      {sorted.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          No {relatedPluralLabel} linked yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--border)]">
          {sorted.map((rec) => (
            <li
              key={rec.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="flex items-center gap-2">
                <a
                  href={`/crm/${segment}/${rec.id}`}
                  className={
                    rec.isArchived
                      ? "text-sm text-[var(--muted-foreground)] line-through hover:underline"
                      : "text-sm text-[var(--accent)] hover:underline"
                  }
                >
                  {relatedLabel(rec)}
                </a>
                {rec.isPrimary ? (
                  <span className="rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
                    Primary
                  </span>
                ) : null}
              </div>
              {canEdit ? (
                <PermissionGate permission={editPermission}>
                  <div className="flex items-center gap-2">
                    {supportsPrimary && !rec.isPrimary ? (
                      <button
                        type="button"
                        disabled={busyId === rec.id}
                        onClick={() => callLink("POST", rec.id, true)}
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--muted)] disabled:opacity-50"
                      >
                        Set primary
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busyId === rec.id}
                      onClick={() => callLink("DELETE", rec.id)}
                      className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </PermissionGate>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
