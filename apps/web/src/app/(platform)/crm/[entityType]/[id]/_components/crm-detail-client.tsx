"use client";

import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  FieldDefinitionWithLabels,
  LayoutConfig,
} from "@adserve/module-framework";
import { crmCollectionSegment } from "@adserve/crm/url";
import {
  CONTACT_BELONGS_TO_ACCOUNT,
  CONTACT_RELATED_TO_ACCOUNT,
  OPPORTUNITY_BELONGS_TO_ACCOUNT,
  OPPORTUNITY_HAS_PRIMARY_CONTACT,
  CAMPAIGN_BELONGS_TO_ACCOUNT,
  CAMPAIGN_HAS_PRIMARY_CONTACT,
} from "@adserve/crm/relationships";
import type { CrmActivityType } from "@adserve/crm";
import { DynamicForm } from "@/components/dynamic-form";
import type { SerializedRecord } from "@/lib/crm/serialize";
import type { RelatedRecord } from "@/lib/crm/relationships";
import { accountSelectionFromRelationships } from "@/lib/crm/account-hydration";
import type { AccountSelection } from "@/components/crm/account-picker";
import type { SerializedActivity } from "../page";
import { AiActivitySummary } from "./ai-activity-summary";
import { DetailTabs, type DetailTab } from "./detail-tabs";
import { Panel } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { RelatedRecordsPanel } from "./related-records-panel";
import { ContactsTable } from "./contacts-table";
import { BrandsPanel } from "./brands-panel";
import { RecordHistoryPanel } from "./record-history-panel";

interface CrmDetailClientProps {
  entitySlug: string;
  collectionSegment: string;
  entityName: string;
  recordId: string;
  title: string;
  record: SerializedRecord;
  fields: FieldDefinitionWithLabels[];
  layoutConfig: LayoutConfig;
  relationships: Record<string, RelatedRecord[]>;
  /** Each linked contact's PRIMARY account (account detail's Account column). */
  contactPrimaryAccounts?: Record<string, { id: string; name: string }>;
  /** The contact's manager, for hydrating the "Reports to" field. */
  contactReportsTo?: { id: string; label: string } | null;
  /** Contacts who report to this contact (direct reports roll-up). */
  contactDirectReports?: { id: string; label: string }[];
  /** Contact form (fields + layout) for creating a contact from this account. */
  contactForm?: {
    fields: FieldDefinitionWithLabels[];
    layoutConfig: LayoutConfig;
  } | null;
  activities: SerializedActivity[];
  canEdit: boolean;
  canArchive: boolean;
  canConvert: boolean;
  canLogActivity: boolean;
  canViewActivities: boolean;
  /** Task 1.7c — show the "Summarize recent activity" AI affordance (accounts). */
  showAiSummary?: boolean;
  /** Module-config driven: which pipeline-entity tabs the Account detail shows. */
  showCampaigns?: boolean;
  showOpportunities?: boolean;
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
  entitySlug,
  collectionSegment,
  entityName,
  recordId,
  title,
  record,
  fields,
  layoutConfig,
  relationships,
  contactPrimaryAccounts = {},
  contactReportsTo = null,
  contactDirectReports = [],
  contactForm = null,
  activities,
  canEdit,
  canArchive,
  canConvert,
  canLogActivity,
  canViewActivities,
  showAiSummary = false,
  showCampaigns = false,
  showOpportunities = false,
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
    // The `account` relationship is a form field but not records.data — pull it
    // out and route it as the account directive (same shape as create). Its
    // presence in `validated` (the form had the field) is the signal to apply;
    // null clears the link.
    const hasAccount = "account" in validated;
    const sel = validated.account as AccountSelection | null | undefined;
    delete validated.account;
    const account = hasAccount
      ? sel?.kind === "existing"
        ? { accountId: sel.id }
        : sel?.kind === "new"
          ? { newAccountName: sel.name }
          : null
      : undefined;

    // `reportsTo` is likewise a relationship field, routed to the reportsTo
    // directive (existing contact only; null clears).
    const hasReportsTo = "reportsTo" in validated;
    const mgr = validated.reportsTo as AccountSelection | null | undefined;
    delete validated.reportsTo;
    const reportsTo = hasReportsTo
      ? mgr?.kind === "existing"
        ? { contactId: mgr.id }
        : null
      : undefined;

    const res = await fetch(`/api/crm/${collectionSegment}/${recordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: validated,
        ...(hasAccount ? { account } : {}),
        ...(hasReportsTo ? { reportsTo } : {}),
      }),
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

  async function handleReactivate() {
    setActionError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/${collectionSegment}/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: {}, isArchived: false }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? `Reactivate failed (${res.status})`);
        return;
      }
      startTransition(() => router.refresh());
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

  // For contacts, accounts are surfaced via the primary field (form) + the
  // Related Accounts panel, so drop them from the generic "Related" sidebar to
  // avoid duplication.
  const relationshipSlugs = Object.keys(relationships)
    .filter((s) => !(entitySlug === "contact" && s === "account"))
    .sort();

  // Editable Related Accounts panel for the contact detail (M2M, owner-is-
  // source). Reuses the WS2 add/remove route; the server rejects relating a
  // contact to its own primary account.
  const relatedAccountsNode: ReactNode =
    entitySlug === "contact" ? (
      <RelatedRecordsPanel
        relatedSlug="account"
        relatedPluralLabel="related accounts"
        owningSegment={collectionSegment}
        owningId={recordId}
        relationshipName={CONTACT_RELATED_TO_ACCOUNT.name}
        direction="owner-is-source"
        items={(relationships.account ?? []).filter(
          (a) => a.relationshipName === CONTACT_RELATED_TO_ACCOUNT.name
        )}
        editPermission="contact.update"
        supportsPrimary={false}
        canEdit={canEdit}
      />
    ) : null;

  // Direct reports (the reverse of "reports to") — read-only roll-up.
  const directReportsNode: ReactNode =
    entitySlug === "contact" && contactDirectReports.length > 0 ? (
      <Panel as="section" title="Direct reports" aria-label="Direct reports">
        <ul className="mt-2 space-y-1">
          {contactDirectReports.map((r) => (
            <li key={r.id}>
              <a
                href={`/crm/${collectionSegment}/${r.id}`}
                className="text-sm text-[var(--accent)] hover:underline"
              >
                {r.label}
              </a>
            </li>
          ))}
        </ul>
      </Panel>
    ) : null;

  // Hydrate the account relationship field (contacts) from the existing link so
  // the detail/edit form shows the linked account instead of "—".
  const formInitialData =
    entitySlug === "contact"
      ? {
          ...record.data,
          account: accountSelectionFromRelationships(relationships),
          reportsTo: contactReportsTo
            ? {
                kind: "existing" as const,
                id: contactReportsTo.id,
                label: contactReportsTo.label,
              }
            : null,
        }
      : record.data;

  // The "Details" form, reused as the first tab (account/opportunity variants)
  // and as the main column (contact/lead).
  const formNode: ReactNode = (
    <div>
      <DynamicForm
        key={mode}
        layoutConfig={layoutConfig}
        fields={fields}
        initialData={formInitialData}
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
  );

  const activityNode: ReactNode = canViewActivities ? (
    <section aria-label="Activity timeline">
      <h2 className="text-sm font-semibold tracking-tight">Activity</h2>
      {showAiSummary ? <AiActivitySummary accountId={recordId} /> : null}
      {activities.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          No activity yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {activities.map((a) => {
            const text = typeof a.body.text === "string" ? a.body.text : "";
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
  ) : null;

  // The legacy "Related" sidebar list (contact / lead variants keep this).
  const legacyRelatedNode: ReactNode = (
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
                          : "text-sm text-[var(--accent)] hover:underline"
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
  );

  // Account/opportunity/contact variants get a tabbed layout.
  const isAccount = entitySlug === "account";
  const isOpportunity = entitySlug === "opportunity";
  const isContact = entitySlug === "contact";
  const isCampaign = entitySlug === "campaign";
  const useTabs = isAccount || isOpportunity || isContact || isCampaign;

  // Placeholder for tabs whose pages are designed as separate activities.
  const comingSoon = (what: string): ReactNode => (
    <Panel as="section" aria-label={what} title={what}>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        {what} is coming soon — designed as a separate activity.
      </p>
    </Panel>
  );

  let tabs: DetailTab[] = [];
  if (isAccount) {
    // The Details tab stacks the field panels (DynamicForm — first panel open,
    // the rest collapsible accordions) followed by the Brands child-record
    // panel and the Account History (audit) panel, both collapsible.
    const accountDetails: ReactNode = (
      <div className="space-y-6">
        {formNode}
        <BrandsPanel
          accountId={recordId}
          items={relationships.brand ?? []}
          canEdit={canEdit}
        />
        <RecordHistoryPanel
          entitySegment={collectionSegment}
          recordId={recordId}
          title="Account History"
        />
      </div>
    );
    tabs = [
      { id: "details", label: "Details", content: accountDetails },
      ...(activityNode
        ? [{ id: "activity", label: "Activity", content: activityNode }]
        : []),
      {
        // One "Contacts" tab with two tables: the account's own contacts
        // (primary) and contacts merely linked to it (related). Both are the
        // same entity to the user; the DB-level split (primary M2O vs related
        // M2M) stays under the hood. Add/remove is scoped to the contact as
        // source → cosmetic gate is `contact.update`.
        id: "contacts",
        label: "Contacts",
        content: (
          <div className="flex h-[calc(100vh-16rem)] min-h-[32rem] flex-col gap-6">
            <ContactsTable
              title="Contacts"
              items={(relationships.contact ?? []).filter(
                (c) => c.relationshipName === CONTACT_BELONGS_TO_ACCOUNT.name
              )}
              primaryAccountById={contactPrimaryAccounts}
              owningSegment={collectionSegment}
              owningId={recordId}
              relationshipName={CONTACT_BELONGS_TO_ACCOUNT.name}
              direction="owner-is-target"
              editPermission="contact.update"
              canEdit={canEdit}
              fillHeight
              createContext={
                contactForm
                  ? {
                      fields: contactForm.fields,
                      layoutConfig: contactForm.layoutConfig,
                      accountId: recordId,
                      accountName: title,
                      locale,
                    }
                  : undefined
              }
            />
            <ContactsTable
              title="Linked Contacts"
              items={(relationships.contact ?? []).filter(
                (c) => c.relationshipName === CONTACT_RELATED_TO_ACCOUNT.name
              )}
              primaryAccountById={contactPrimaryAccounts}
              owningSegment={collectionSegment}
              owningId={recordId}
              relationshipName={CONTACT_RELATED_TO_ACCOUNT.name}
              direction="owner-is-target"
              editPermission="contact.update"
              canEdit={canEdit}
              fillHeight
            />
          </div>
        ),
      },
      // Pipeline-entity tabs follow the tenant's module config: Campaigns
      // and/or Opportunities (or neither). Account is the TARGET of the
      // *_belongs_to_account relationships (the deal is the source), so the
      // WS2 source-scoped gate is the deal's update permission, NOT account's.
      ...(showCampaigns
        ? [
            {
              id: "campaigns",
              label: "Campaigns",
              content: (
                <RelatedRecordsPanel
                  relatedSlug="campaign"
                  relatedPluralLabel="campaigns"
                  owningSegment={collectionSegment}
                  owningId={recordId}
                  relationshipName={CAMPAIGN_BELONGS_TO_ACCOUNT.name}
                  direction="owner-is-target"
                  items={relationships.campaign ?? []}
                  editPermission="campaign.update"
                  supportsPrimary={false}
                  canEdit={canEdit}
                />
              ),
            } as DetailTab,
          ]
        : []),
      ...(showOpportunities
        ? [
            {
              id: "opportunities",
              label: "Opportunities",
              content: (
                <RelatedRecordsPanel
                  relatedSlug="opportunity"
                  relatedPluralLabel="opportunities"
                  owningSegment={collectionSegment}
                  owningId={recordId}
                  relationshipName={OPPORTUNITY_BELONGS_TO_ACCOUNT.name}
                  direction="owner-is-target"
                  items={relationships.opportunity ?? []}
                  editPermission="opportunity.update"
                  supportsPrimary={false}
                  canEdit={canEdit}
                />
              ),
            } as DetailTab,
          ]
        : []),
    ];
  } else if (isOpportunity) {
    tabs = [
      { id: "details", label: "Details", content: formNode },
      ...(activityNode
        ? [{ id: "activity", label: "Activity", content: activityNode }]
        : []),
      {
        id: "account",
        label: "Account",
        content: (
          // Opportunity is the SOURCE of opportunity_belongs_to_account
          // (many_to_one → at most one account; linking replaces).
          <RelatedRecordsPanel
            relatedSlug="account"
            relatedPluralLabel="account"
            owningSegment={collectionSegment}
            owningId={recordId}
            relationshipName={OPPORTUNITY_BELONGS_TO_ACCOUNT.name}
            direction="owner-is-source"
            items={relationships.account ?? []}
            editPermission="opportunity.update"
            supportsPrimary={false}
            canEdit={canEdit}
          />
        ),
      },
      {
        id: "contacts",
        label: "Contacts",
        content: (
          // Opportunity is the SOURCE of opportunity_has_primary_contact; the
          // single-primary invariant is per opportunity, so set-primary applies.
          <RelatedRecordsPanel
            relatedSlug="contact"
            relatedPluralLabel="contacts"
            owningSegment={collectionSegment}
            owningId={recordId}
            relationshipName={OPPORTUNITY_HAS_PRIMARY_CONTACT.name}
            direction="owner-is-source"
            items={relationships.contact ?? []}
            editPermission="opportunity.update"
            supportsPrimary
            canEdit={canEdit}
          />
        ),
      },
    ];
  } else if (isContact) {
    // Contact tabs per the design: Details (the panelled form + related accounts
    // + activity), then Notes & Attachments and Campaigns (separate activities).
    tabs = [
      {
        id: "details",
        label: "Details",
        content: (
          <div className="space-y-6">
            {formNode}
            {relatedAccountsNode}
            {directReportsNode}
            {legacyRelatedNode}
            {activityNode}
          </div>
        ),
      },
      {
        id: "notes",
        label: "Notes & Attachments",
        content: comingSoon("Notes & Attachments"),
      },
      { id: "campaigns", label: "Campaigns", content: comingSoon("Campaigns") },
    ];
  } else if (isCampaign) {
    // Campaign mirrors Opportunity: Details + Notes & Activities, plus owning
    // Account (M2O) and primary Contact (M2M) management. Link/unlink is scoped
    // to the campaign as source → cosmetic gate is `campaign.update`.
    tabs = [
      { id: "details", label: "Details", content: formNode },
      ...(activityNode
        ? [{ id: "activity", label: "Notes & Activities", content: activityNode }]
        : []),
      {
        id: "account",
        label: "Account",
        content: (
          <RelatedRecordsPanel
            relatedSlug="account"
            relatedPluralLabel="account"
            owningSegment={collectionSegment}
            owningId={recordId}
            relationshipName={CAMPAIGN_BELONGS_TO_ACCOUNT.name}
            direction="owner-is-source"
            items={relationships.account ?? []}
            editPermission="campaign.update"
            supportsPrimary={false}
            canEdit={canEdit}
          />
        ),
      },
      {
        id: "contacts",
        label: "Contacts",
        content: (
          <RelatedRecordsPanel
            relatedSlug="contact"
            relatedPluralLabel="contacts"
            owningSegment={collectionSegment}
            owningId={recordId}
            relationshipName={CAMPAIGN_HAS_PRIMARY_CONTACT.name}
            direction="owner-is-source"
            items={relationships.contact ?? []}
            editPermission="campaign.update"
            supportsPrimary
            canEdit={canEdit}
          />
        ),
      },
    ];
  }

  const statusValue =
    typeof record.data.status === "string" ? record.data.status : null;
  const usesInactiveVocab = entitySlug === "contact" || entitySlug === "account";
  const headerStatus = record.isArchived ? (
    <StatusPill tone="neutral">
      {usesInactiveVocab ? "Inactive" : "Archived"}
    </StatusPill>
  ) : statusValue ? (
    <StatusPill status={statusValue} />
  ) : null;

  return (
    <div>
      <PageHeader
        eyebrow={entityName}
        title={title}
        status={headerStatus}
        actions={
          <>
            {canLogActivity ? (
              <button
                type="button"
                onClick={() => {
                  setLogError(null);
                  setLogOpen(true);
                }}
                className="rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)]"
              >
                Log activity
              </button>
            ) : null}
            {showConvert ? (
              <button
                type="button"
                onClick={handleConvert}
                disabled={busy}
                className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:brightness-95 disabled:opacity-50"
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
                className="rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)]"
              >
                Edit
              </button>
            ) : null}
            {canArchive && !record.isArchived ? (
              <button
                type="button"
                onClick={handleArchive}
                disabled={busy}
                className="rounded-md border border-red-300 bg-[var(--panel-bg)] px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {usesInactiveVocab ? "Mark inactive" : "Archive"}
              </button>
            ) : null}
            {canArchive && record.isArchived ? (
              <button
                type="button"
                onClick={handleReactivate}
                disabled={busy}
                className="rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)] disabled:opacity-50"
              >
                Reactivate
              </button>
            ) : null}
          </>
        }
      />

      {actionError ? (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {actionError}
        </p>
      ) : null}

      {useTabs ? (
        <div className="mt-6">
          <DetailTabs tabs={tabs} />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Main form */}
          <div className="lg:col-span-2">{formNode}</div>

          {/* Sidebar */}
          <aside className="space-y-6">
            {relatedAccountsNode}
            {legacyRelatedNode}
            {activityNode}
          </aside>
        </div>
      )}

      {/* Log activity modal */}
      {logOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setLogOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-[var(--panel-bg)] p-6 shadow-xl"
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
                  className="mt-1 w-full rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-sm"
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
                  className="mt-1 w-full rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Notes</span>
                <textarea
                  name="text"
                  rows={3}
                  className="mt-1 w-full rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-sm"
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
                  className="mt-1 w-full rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-sm"
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
                  className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:brightness-95"
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
