"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type {
  ConvertTarget,
  CrmModuleToggles,
} from "@/lib/crm/module-config";

/**
 * CRM module-visibility form. Cosmetic gating only (`canEdit`); the write is
 * authorised server-side by /api/admin/crm/modules (crm.admin). On success it
 * router.refresh()es so nav/routes that key off the config re-render.
 *
 * Accounts + Contacts are always-on and rendered by the page as non-interactive
 * — this form only owns Leads / Campaigns / Opportunities + the convert target.
 */

const MODULES: Array<{
  key: "leads" | "campaigns" | "opportunities";
  label: string;
  description: string;
}> = [
  {
    key: "leads",
    label: "Leads",
    description: "Inbound interest captured before it becomes a deal.",
  },
  {
    key: "campaigns",
    label: "Campaigns",
    description: "Media-first deal records on the pipeline.",
  },
  {
    key: "opportunities",
    label: "Opportunities",
    description: "Classic sales opportunities on the pipeline.",
  },
];

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? "bg-[var(--accent)]" : "bg-[var(--muted)]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export function ModulesForm({
  initial,
  canEdit,
}: {
  initial: CrmModuleToggles;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [toggles, setToggles] = useState<CrmModuleToggles>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bothPipeline = toggles.campaigns && toggles.opportunities;
  const onlyCampaigns = toggles.campaigns && !toggles.opportunities;
  const onlyOpportunities = !toggles.campaigns && toggles.opportunities;

  const effectiveConvert = useMemo<ConvertTarget | null>(() => {
    if (bothPipeline) return toggles.convertTarget;
    if (onlyCampaigns) return "campaign";
    if (onlyOpportunities) return "opportunity";
    return null;
  }, [bothPipeline, onlyCampaigns, onlyOpportunities, toggles.convertTarget]);

  async function persist(next: CrmModuleToggles) {
    const previous = toggles;
    setToggles(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/crm/modules", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        setToggles(previous);
        setError("Could not save. Please try again.");
        return;
      }
      const saved = (await res.json()) as CrmModuleToggles;
      setToggles(saved);
      router.refresh();
    } catch {
      setToggles(previous);
      setError("Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function setModule(key: "leads" | "campaigns" | "opportunities", v: boolean) {
    if (!canEdit || saving) return;
    void persist({ ...toggles, [key]: v });
  }

  function setConvertTarget(target: ConvertTarget) {
    if (!canEdit || saving || target === toggles.convertTarget) return;
    void persist({ ...toggles, convertTarget: target });
  }

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-[var(--border)]">
        {MODULES.map((m) => (
          <li
            key={m.key}
            className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {m.label}
              </p>
              <p className="text-sm text-[var(--muted-foreground)]">
                {m.description}
              </p>
            </div>
            <Toggle
              label={m.label}
              checked={toggles[m.key]}
              disabled={!canEdit || saving}
              onChange={(v) => setModule(m.key, v)}
            />
          </li>
        ))}
      </ul>

      <div className="rounded-lg border border-[var(--border)] p-4">
        <p className="text-sm font-medium text-[var(--foreground)]">
          Lead conversion
        </p>
        {bothPipeline ? (
          <div className="mt-3">
            <p className="text-sm text-[var(--muted-foreground)]">
              On Lead conversion, create:
            </p>
            <div
              role="radiogroup"
              aria-label="On Lead conversion, create"
              className="mt-2 flex flex-wrap gap-2"
            >
              {(["campaign", "opportunity"] as const).map((target) => {
                const active = toggles.convertTarget === target;
                return (
                  <button
                    key={target}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!canEdit || saving}
                    onClick={() => setConvertTarget(target)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      active
                        ? "border-[var(--accent)] ring-2 ring-[var(--accent)]"
                        : "border-[var(--border)] hover:bg-[var(--muted)]"
                    }`}
                  >
                    {target}
                  </button>
                );
              })}
            </div>
          </div>
        ) : effectiveConvert ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Converting a Lead will create a{" "}
            <span className="font-medium text-[var(--foreground)] capitalize">
              {effectiveConvert}
            </span>{" "}
            (plus the Account &amp; Contact).
          </p>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Leads convert to Account + Contact only.
          </p>
        )}
      </div>

      {!canEdit && (
        <p className="text-sm text-[var(--muted-foreground)]">
          View only. Your role cannot change CRM modules.
        </p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
