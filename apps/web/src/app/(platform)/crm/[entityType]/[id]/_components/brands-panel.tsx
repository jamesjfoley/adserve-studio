"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CollapsiblePanel } from "@/components/ui/collapsible-panel";
import { PermissionGate } from "@/lib/permissions-client";
import type { RelatedRecord } from "@/lib/crm/relationships";

/** Brand category choices (mirror DEFAULT_BRAND_FIELDS in @adserve/crm). */
const CATEGORY_CHOICES: { value: string; label: string }[] = [
  { value: "Government", label: "Government" },
  { value: "Retail", label: "Retail" },
  { value: "Automotive", label: "Automotive" },
  { value: "Finance", label: "Finance" },
  { value: "FMCG", label: "FMCG" },
  { value: "Leisure", label: "Leisure" },
  { value: "Other", label: "Other" },
];
const CATEGORY_LABEL = new Map(CATEGORY_CHOICES.map((c) => [c.value, c.label]));

interface BrandsPanelProps {
  /** The owning account record id. */
  accountId: string;
  /** Brands linked to this account (relationships.brand). */
  items: RelatedRecord[];
  canEdit: boolean;
}

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === "string" ? v : "";
}

const headClass = "px-4 py-3 text-left text-xs font-medium";
const cellClass = "px-4 py-3 text-sm align-top";

/**
 * Account "Brands" panel — the linked Brand child records (Brand / Category /
 * Values) with an inline add row and per-row delete. Brands are created via
 * /api/crm/brands/with-account (brand_belongs_to_account, M2O) and archived via
 * the generic record DELETE. Editing an existing brand is a follow-up.
 */
export function BrandsPanel({ accountId, items, canEdit }: BrandsPanelProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [values, setValues] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = items.filter((b) => !b.isArchived);

  async function add() {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    const data: Record<string, unknown> = { name: name.trim() };
    if (category) data.category = category;
    if (values.trim()) data.values = values.trim();
    const res = await fetch(`/api/crm/brands/with-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, accountId }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Add failed (${res.status})`);
      return;
    }
    setName("");
    setCategory("");
    setValues("");
    router.refresh();
  }

  async function remove(brandId: string) {
    setError(null);
    const res = await fetch(`/api/crm/brands/${brandId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Delete failed (${res.status})`);
      return;
    }
    router.refresh();
  }

  const inputClass =
    "w-full rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

  return (
    <CollapsiblePanel as="section" title="Brands" collapsible defaultOpen>
      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border)] bg-[var(--table-header-bg)] text-left text-xs font-medium text-[var(--muted-foreground)]">
            <tr>
              <th className={headClass}>Brand</th>
              <th className={headClass}>Brand Category</th>
              <th className={headClass}>Brand Values</th>
              {canEdit ? <th className="w-12 px-2 py-3" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {canEdit ? (
              <PermissionGate permission="brand.create">
                <tr className="bg-[var(--row-alt)]">
                  <td className="px-4 py-2">
                    <input
                      aria-label="Brand"
                      className={inputClass}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void add();
                      }}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <select
                      aria-label="Brand Category"
                      className={inputClass}
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="">Select…</option>
                      {CATEGORY_CHOICES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      aria-label="Brand Values"
                      className={inputClass}
                      value={values}
                      onChange={(e) => setValues(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void add();
                      }}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void add()}
                      disabled={busy || name.trim() === ""}
                      className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] hover:brightness-95 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </td>
                </tr>
              </PermissionGate>
            ) : null}

            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={canEdit ? 4 : 3}
                  className="px-4 py-6 text-center text-sm text-[var(--muted-foreground)]"
                >
                  No brands yet.
                </td>
              </tr>
            ) : (
              visible.map((b) => {
                const cat = str(b.data, "category");
                return (
                  <tr key={b.id} className="hover:bg-[var(--row-hover)]">
                    <td className={cellClass}>{str(b.data, "name") || "—"}</td>
                    <td className={cellClass}>
                      {cat ? CATEGORY_LABEL.get(cat) ?? cat : "—"}
                    </td>
                    <td className={cellClass}>{str(b.data, "values") || "—"}</td>
                    {canEdit ? (
                      <td className="px-2 py-3 text-right">
                        <PermissionGate permission="brand.delete">
                          <button
                            type="button"
                            aria-label={`Delete ${str(b.data, "name")}`}
                            onClick={() => void remove(b.id)}
                            className="rounded-md px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-red-600"
                          >
                            🗑
                          </button>
                        </PermissionGate>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </CollapsiblePanel>
  );
}
