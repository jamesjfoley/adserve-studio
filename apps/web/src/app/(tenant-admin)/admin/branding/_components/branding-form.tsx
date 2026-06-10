"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * Branding & shell form. The write is authorised server-side by
 * /api/admin/shell (tenant.admin OR crm.admin); this form only drives the UI.
 *
 * Logo: pick an image file, read it as a data: URL (rejecting anything over
 * ~500KB), preview it, then Save to PATCH { logoUrl }. "Remove logo" clears it.
 * Title bar mode: a radio group bound to titleBarMode, saved via the same
 * endpoint. On success it router.refresh()es so the shell re-reads settings.
 */

type TitleBarMode = "always" | "auto-hide";

// Reject data URLs larger than ~500KB (the endpoint independently bounds at
// ~700k chars; this is the friendlier client-side gate).
const MAX_LOGO_BYTES = 500 * 1024;

export function BrandingForm({
  initialLogoUrl,
  initialTitleBarMode,
}: {
  initialLogoUrl: string | null;
  initialTitleBarMode: TitleBarMode;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl);
  const [savedLogoUrl, setSavedLogoUrl] = useState<string | null>(
    initialLogoUrl
  );
  const [titleBarMode, setTitleBarMode] =
    useState<TitleBarMode>(initialTitleBarMode);

  const [logoSaving, setLogoSaving] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [modeSaving, setModeSaving] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);

  const logoDirty = logoUrl !== savedLogoUrl;

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setLogoError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        setLogoError("Could not read that file.");
        return;
      }
      // Bound by the decoded size of the resulting data URL.
      if (result.length > MAX_LOGO_BYTES * 1.4) {
        setLogoError("That image is too large. Please choose one under 500KB.");
        return;
      }
      setLogoUrl(result);
    };
    reader.onerror = () => setLogoError("Could not read that file.");
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    setLogoError(null);
    setLogoUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function saveLogo() {
    setLogoSaving(true);
    setLogoError(null);
    try {
      const res = await fetch("/api/admin/shell", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ logoUrl }),
      });
      if (!res.ok) {
        setLogoError("Could not save the logo. Please try again.");
        return;
      }
      const saved = (await res.json()) as { logoUrl: string | null };
      setLogoUrl(saved.logoUrl ?? null);
      setSavedLogoUrl(saved.logoUrl ?? null);
      router.refresh();
    } catch {
      setLogoError("Could not save the logo. Please try again.");
    } finally {
      setLogoSaving(false);
    }
  }

  async function selectMode(next: TitleBarMode) {
    if (modeSaving || next === titleBarMode) return;
    const previous = titleBarMode;
    setTitleBarMode(next);
    setModeSaving(true);
    setModeError(null);
    try {
      const res = await fetch("/api/admin/shell", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ titleBarMode: next }),
      });
      if (!res.ok) {
        setTitleBarMode(previous);
        setModeError("Could not save. Please try again.");
        return;
      }
      const saved = (await res.json()) as { titleBarMode: TitleBarMode };
      setTitleBarMode(saved.titleBarMode);
      router.refresh();
    } catch {
      setTitleBarMode(previous);
      setModeError("Could not save. Please try again.");
    } finally {
      setModeSaving(false);
    }
  }

  const TITLE_BAR_OPTIONS: Array<{
    value: TitleBarMode;
    label: string;
    description: string;
  }> = [
    {
      value: "always",
      label: "Always shown",
      description: "The title bar is permanently visible at the top.",
    },
    {
      value: "auto-hide",
      label: "Auto-hide (reveal on hover)",
      description: "The title bar hides and slides in when you hover the top edge.",
    },
  ];

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--muted)]">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt="Company logo preview"
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="px-2 text-center text-xs text-[var(--muted-foreground)]">
                No logo
              </span>
            )}
          </div>
          <div className="min-w-0 space-y-2">
            <label className="block text-sm font-medium text-[var(--foreground)]">
              Logo image
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onFileChange}
              disabled={logoSaving}
              className="block w-full text-sm text-[var(--muted-foreground)] file:mr-3 file:rounded-lg file:border file:border-[var(--border)] file:bg-[var(--muted)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--foreground)] hover:file:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              PNG, JPG or SVG. Maximum 500KB.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={saveLogo}
            disabled={logoSaving || !logoDirty}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {logoSaving ? "Saving…" : "Save logo"}
          </button>
          <button
            type="button"
            onClick={removeLogo}
            disabled={logoSaving || logoUrl === null}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Remove logo
          </button>
        </div>
        {logoError && <p className="text-sm text-red-700">{logoError}</p>}
      </div>

      <div className="rounded-lg border border-[var(--border)] p-4">
        <p className="text-sm font-medium text-[var(--foreground)]">
          Title bar display
        </p>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Choose how the platform title bar behaves.
        </p>
        <div
          role="radiogroup"
          aria-label="Title bar display mode"
          className="mt-3 grid gap-2"
        >
          {TITLE_BAR_OPTIONS.map((opt) => {
            const active = titleBarMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={modeSaving}
                onClick={() => selectMode(opt.value)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  active
                    ? "border-[var(--accent)] ring-2 ring-[var(--accent)]"
                    : "border-[var(--border)] hover:bg-[var(--muted)]"
                }`}
              >
                <span className="block font-medium text-[var(--foreground)]">
                  {opt.label}
                </span>
                <span className="block text-xs text-[var(--muted-foreground)]">
                  {opt.description}
                </span>
              </button>
            );
          })}
        </div>
        {modeError && <p className="mt-2 text-sm text-red-700">{modeError}</p>}
      </div>
    </div>
  );
}
