"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useClerk } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { usePersistentState } from "@/lib/use-persistent-state";
import type { ShellModule, TitleBarMode } from "@/lib/shell";

export interface TitleBarProps {
  /** The tenant's module catalogue (candy box). */
  modules: ShellModule[];
  /** Personalisation logo (data: or http URL), or null → the "as" wordmark. */
  logoUrl: string | null;
  /** Name of the active module, shown centred (e.g. "CRM"). */
  moduleName: string;
  /** Logged-in user's initials roundel + full name. */
  initials: string;
  userName: string;
  version: string;
  /**
   * Tenant/admin default display mode. The USER can override it (lock/unlock),
   * persisted per user — this is only the starting value.
   */
  defaultMode: TitleBarMode;
  /** Current user's id — namespaces the per-user title-bar preference. */
  storageScope?: string;
}

function isTitleBarMode(v: unknown): v is TitleBarMode {
  return v === "always" || v === "auto-hide";
}

/** Lock (pinned/always) vs unlock (floating/auto-hide) toggle. */
function LockToggle({
  locked,
  onToggle,
}: {
  locked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={locked}
      aria-label={
        locked
          ? "Unlock title bar (auto-hide)"
          : "Lock title bar (keep visible)"
      }
      title={
        locked
          ? "Title bar locked — click to let it auto-hide"
          : "Title bar floating — click to keep it visible"
      }
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-md hover:bg-[var(--muted)]",
        locked
          ? "text-[var(--accent)]"
          : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      )}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="7" width="10" height="6.5" rx="1.5" fill={locked ? "currentColor" : "none"} />
        {locked ? (
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        ) : (
          <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" />
        )}
      </svg>
    </button>
  );
}

/** 3×3 "candy box" dot grid. */
function CandyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="currentColor">
      {[2, 9, 16].flatMap((cy) =>
        [2, 9, 16].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" />)
      )}
    </svg>
  );
}

/** Click-away backdrop shared by the menus. */
function Backdrop({ onClose }: { onClose: () => void }) {
  return <div className="fixed inset-0 z-40" aria-hidden="true" onClick={onClose} />;
}

function CandyBox({ modules }: { modules: ShellModule[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Switch module"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <CandyIcon />
      </button>
      {open ? (
        <>
          <Backdrop onClose={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] p-2 shadow-lg">
            <p className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Modules
            </p>
            <ul className="space-y-0.5">
              {modules.map((m) =>
                m.available && m.href ? (
                  <li key={m.slug}>
                    <Link
                      href={m.href}
                      onClick={() => setOpen(false)}
                      className="block rounded-md px-2 py-2 text-sm font-medium hover:bg-[var(--row-hover)]"
                    >
                      {m.name}
                    </Link>
                  </li>
                ) : (
                  <li
                    key={m.slug}
                    className="flex items-center justify-between rounded-md px-2 py-2 text-sm text-[var(--muted-foreground)]"
                  >
                    <span>{m.name}</span>
                    <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide">
                      Soon
                    </span>
                  </li>
                )
              )}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

function UserMenu({
  initials,
  userName,
  version,
}: {
  initials: string;
  userName: string;
  version: string;
}) {
  const [open, setOpen] = useState(false);
  const { signOut } = useClerk();
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="User menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--foreground)] text-xs font-semibold text-[var(--background)] hover:brightness-110"
      >
        {initials}
      </button>
      {open ? (
        <>
          <Backdrop onClose={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] p-2 text-sm shadow-lg">
            <div className="border-b border-[var(--border)] px-2 pb-2 pt-1">
              <p className="font-medium">{userName}</p>
            </div>
            <a
              href="mailto:support@adserve.com?subject=Support%20request"
              onClick={() => setOpen(false)}
              className="block rounded-md px-2 py-2 hover:bg-[var(--row-hover)]"
            >
              Ask a support question
            </a>
            <div
              className="flex items-center justify-between rounded-md px-2 py-2 text-[var(--muted-foreground)]"
              aria-disabled="true"
            >
              <span>Workflows</span>
              <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide">
                Soon
              </span>
            </div>
            <div className="px-2 py-2 text-xs text-[var(--muted-foreground)]">
              Version {version}
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void signOut({ redirectUrl: "/sign-in" });
              }}
              className="mt-1 block w-full rounded-md border-t border-[var(--border)] px-2 py-2 text-left font-medium hover:bg-[var(--row-hover)]"
            >
              Log out
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function BarContent({
  modules,
  logoUrl,
  moduleName,
  initials,
  userName,
  version,
  locked,
  onToggleLock,
}: {
  modules: ShellModule[];
  logoUrl: string | null;
  moduleName: string;
  initials: string;
  userName: string;
  version: string;
  locked: boolean;
  onToggleLock: () => void;
}): ReactNode {
  return (
    <div className="flex h-12 w-full items-center gap-3 border-b border-[var(--border)] bg-[var(--panel-bg)] px-3">
      <CandyBox modules={modules} />
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="Company logo" className="h-7 w-auto max-w-[140px] object-contain" />
      ) : (
        <span className="select-none text-lg font-bold lowercase tracking-tight text-[var(--accent)]">
          as
        </span>
      )}
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm font-semibold tracking-tight">{moduleName}</span>
      </div>
      <LockToggle locked={locked} onToggle={onToggleLock} />
      <UserMenu initials={initials} userName={userName} version={version} />
    </div>
  );
}

/**
 * Platform title bar — sits above every module surface. Each USER chooses
 * whether it's locked (permanently visible, "always") or floating ("auto-hide":
 * hidden until the cursor enters a thin reveal strip, re-hiding on leave). The
 * choice persists per user (localStorage), seeded from the tenant/admin default.
 *
 * Locked mode occupies the top of the layout in flow; floating mode overlays
 * the top and reserves no vertical space.
 */
export function TitleBar({ defaultMode, storageScope, ...rest }: TitleBarProps) {
  const [revealed, setRevealed] = useState(false);
  const [mode, setMode] = usePersistentState<TitleBarMode>(
    storageScope ? `adserve:shell:titleBarMode:${storageScope}` : null,
    defaultMode,
    isTitleBarMode
  );
  const locked = mode === "always";
  const toggleLock = () => setMode(locked ? "auto-hide" : "always");
  const bar = (
    <BarContent {...rest} locked={locked} onToggleLock={toggleLock} />
  );

  if (locked) {
    return (
      <header className="relative z-30 shrink-0">{bar}</header>
    );
  }

  return (
    <>
      {/* Reveal strip (always at the very top). */}
      <div
        className="fixed inset-x-0 top-0 z-40 h-2"
        aria-hidden="true"
        onMouseEnter={() => setRevealed(true)}
      />
      <header
        onMouseLeave={() => setRevealed(false)}
        className={cn(
          "fixed inset-x-0 top-0 z-50 shadow-sm transition-transform duration-200",
          revealed ? "translate-y-0" : "-translate-y-full"
        )}
      >
        {bar}
      </header>
    </>
  );
}
