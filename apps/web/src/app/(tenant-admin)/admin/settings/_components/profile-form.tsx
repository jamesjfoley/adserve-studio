"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Initial = {
  name: string;
  contactEmail: string;
  phone: string;
  address: string;
  logoUrl: string;
};

export function ProfileForm({
  canEdit,
  initial,
}: {
  canEdit: boolean;
  initial: Initial;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [values, setValues] = useState<Initial>(initial);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof Initial>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedAt(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          contactEmail: values.contactEmail,
          phone: values.phone,
          address: values.address,
          logoUrl: values.logoUrl,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `Request failed (${res.status})`);
        return;
      }
      setSavedAt(Date.now());
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Name"
          required
          disabled={!canEdit}
          value={values.name}
          onChange={(v) => update("name", v)}
        />
        <Field
          label="Contact email"
          type="email"
          disabled={!canEdit}
          value={values.contactEmail}
          onChange={(v) => update("contactEmail", v)}
        />
        <Field
          label="Phone"
          disabled={!canEdit}
          value={values.phone}
          onChange={(v) => update("phone", v)}
        />
        <Field
          label="Logo URL"
          placeholder="https://…"
          disabled={!canEdit}
          value={values.logoUrl}
          onChange={(v) => update("logoUrl", v)}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[var(--muted-foreground)]">
          Address
        </label>
        <textarea
          rows={3}
          disabled={!canEdit}
          value={values.address}
          onChange={(e) => update("address", e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm disabled:opacity-60"
        />
      </div>

      {values.logoUrl && (
        <div>
          <p className="text-xs font-medium text-[var(--muted-foreground)]">
            Logo preview
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={values.logoUrl}
            alt="Logo preview"
            className="mt-2 h-16 max-w-full rounded border border-[var(--border)] object-contain"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {savedAt && (
        <p className="text-sm text-green-700" role="status">
          Saved.
        </p>
      )}

      {canEdit && (
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:brightness-95 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  required = false,
  disabled = false,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  disabled?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--muted-foreground)]">
        {label}
      </label>
      <input
        type={type}
        required={required}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm disabled:opacity-60"
      />
    </div>
  );
}
