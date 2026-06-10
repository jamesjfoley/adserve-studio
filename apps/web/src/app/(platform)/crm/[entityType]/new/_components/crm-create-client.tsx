"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  FieldDefinitionWithLabels,
  LayoutConfig,
} from "@adserve/module-framework";
import { DynamicForm } from "@/components/dynamic-form";
import { PageHeader } from "@/components/ui/page-header";
import type { AccountSelection } from "@/components/crm/account-picker";

interface CrmCreateClientProps {
  slug: string;
  collectionSegment: string;
  entityName: string;
  fields: FieldDefinitionWithLabels[];
  layoutConfig: LayoutConfig;
  locale: string;
}

/**
 * Full-page create form for a CRM record — the entity's detail layout (panels,
 * accordions, field spans) rendered in create mode, replacing the cramped
 * modal. Mandatory fields are enforced by DynamicForm before submit; on success
 * we land on the new record's detail page.
 *
 * Relationship-backed fields rendered inline (contact→account, campaign→account
 * + primary contact) are pulled out of the form data and routed to the matching
 * atomic create-with-link endpoint, exactly as the list flow did.
 */
export function CrmCreateClient({
  slug,
  collectionSegment,
  entityName,
  fields,
  layoutConfig,
  locale,
}: CrmCreateClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(validated: Record<string, unknown>) {
    setError(null);

    // `account` (contact/campaign), `reportsTo` (contact), `primaryContact`
    // (campaign) render inline as relationship pickers but are NOT records.data
    // fields — pull them out and route to the atomic combined endpoints.
    const sel = (validated.account as AccountSelection | null | undefined) ?? null;
    delete validated.account;
    const accountBody =
      sel?.kind === "existing"
        ? { accountId: sel.id }
        : sel?.kind === "new"
          ? { newAccountName: sel.name }
          : {};
    const mgr = (validated.reportsTo as AccountSelection | null | undefined) ?? null;
    const hasReportsTo = "reportsTo" in validated;
    delete validated.reportsTo;
    const reportsToBody =
      hasReportsTo && mgr?.kind === "existing"
        ? { reportsTo: { contactId: mgr.id } }
        : {};
    const pc = (validated.primaryContact as AccountSelection | null | undefined) ?? null;
    delete validated.primaryContact;
    const primaryContactBody =
      pc?.kind === "existing" ? { primaryContactId: pc.id } : {};

    let res: Response;
    if (slug === "campaign") {
      res = await fetch(`/api/crm/campaigns/with-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: validated, ...accountBody, ...primaryContactBody }),
      });
    } else if (slug === "contact") {
      res = await fetch(`/api/crm/contacts/with-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: validated, ...accountBody, ...reportsToBody }),
      });
    } else {
      res = await fetch(`/api/crm/${collectionSegment}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: validated }),
      });
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Create failed (${res.status})`);
      return;
    }
    const body = await res.json().catch(() => ({}));
    const newId = body.record?.id as string | undefined;
    // Land on the new record's detail page (or back to the list as a fallback).
    startTransition(() =>
      router.push(
        newId
          ? `/crm/${collectionSegment}/${newId}`
          : `/crm/${collectionSegment}`
      )
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={entityName}
        title={`New ${entityName.toLowerCase()}`}
        subtitle="Complete the required fields, then save."
        actions={
          <button
            type="button"
            onClick={() => router.push(`/crm/${collectionSegment}`)}
            className="rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)]"
          >
            Cancel
          </button>
        }
      />
      <div className="mt-6">
        <DynamicForm
          layoutConfig={layoutConfig}
          fields={fields}
          initialData={null}
          mode="create"
          onSubmit={handleCreate}
          submitError={error}
          submitLabel={`Create ${entityName.toLowerCase()}`}
          locale={locale}
        />
      </div>
    </div>
  );
}
