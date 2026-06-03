"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { NAV_ICONS, type NavIconName } from "./nav-icons";
import { useNavPinned } from "./use-nav-pinned";

export interface NavItem {
  name: string;
  href: string;
  iconName: NavIconName;
  /** Accent treatment (e.g. the Super Admin / Admin shortcut links). */
  accent?: boolean;
}

interface PrimaryNavProps {
  /** Main nav links (rendered under `groupLabel`). */
  items: NavItem[];
  /** Optional links rendered above the group label (accent shortcuts). */
  topItems?: NavItem[];
  /** Section label above `items` (e.g. "CRM"). */
  groupLabel?: string;
  /** Server-rendered slot at the top (e.g. Clerk OrganizationSwitcher). */
  header?: ReactNode;
  /** Server-rendered slot at the bottom (e.g. Clerk UserButton). */
  footer?: ReactNode;
}

// Overlay timing: a short open delay keeps a quick pass over the rail from
// flashing the overlay open; the close delay prevents flicker when the pointer
// briefly leaves and returns.
const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 200;

/** Amendment 2 — Cmd/Ctrl+B must no-op while focus is in an editable surface. */
function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (el.getAttribute("role") === "textbox") return true;
  return false;
}

export function PrimaryNav({
  items,
  topItems = [],
  groupLabel,
  header,
  footer,
}: PrimaryNavProps) {
  const { pinned, toggle } = useNavPinned();
  const pathname = usePathname();
  // Active when the path equals the link or sits beneath it (e.g.
  // /crm/accounts/123 → Accounts). Accent shortcut chips are never "active".
  const isActive = (href: string) =>
    !!pathname && (pathname === href || pathname.startsWith(`${href}/`));
  // Overlay expansion (unpinned desktop only) and the mobile drawer are pure
  // interaction state — they are never persisted and never affect first paint.
  const [expanded, setExpanded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  // Global Cmd/Ctrl+B toggles pin (Amendment 2: suppressed in editable fields).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
        if (isEditableTarget(document.activeElement)) return;
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  // Re-pinning closes any open overlay and cancels pending timers.
  useEffect(() => {
    if (pinned) {
      clearTimers();
      setExpanded(false);
    }
  }, [pinned, clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const openOverlay = useCallback(() => {
    if (pinned) return;
    clearTimers();
    openTimer.current = window.setTimeout(
      () => setExpanded(true),
      OPEN_DELAY_MS
    );
  }, [pinned, clearTimers]);

  const closeOverlay = useCallback(() => {
    clearTimers();
    closeTimer.current = window.setTimeout(
      () => setExpanded(false),
      CLOSE_DELAY_MS
    );
  }, [clearTimers]);

  function renderLinks(
    list: NavItem[],
    opts?: { forceLabels?: boolean; onNavigate?: () => void }
  ) {
    return list.map((item) => {
      const Icon = NAV_ICONS[item.iconName];
      const active = !item.accent && isActive(item.href);
      // Accent shortcut chip, active route, or neutral — all accent treatment
      // flows through var(--accent) so it follows the per-org palette.
      const tone = item.accent
        ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]"
        : active
          ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
          : "text-[var(--foreground)] hover:bg-[var(--background)]";
      return (
        <Link
          key={item.name}
          href={item.href}
          onClick={opts?.onNavigate}
          aria-current={active ? "page" : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${tone}`}
        >
          <Icon
            className={`h-4 w-4 shrink-0 ${
              item.accent || active ? "" : "text-[var(--muted-foreground)]"
            }`}
          />
          {/* The label stays in the DOM when the rail is collapsed (CSS only
              visually hides it), so the link keeps its accessible name. */}
          <span className={opts?.forceLabels ? "" : "primary-nav-label"}>
            {item.name}
          </span>
        </Link>
      );
    });
  }

  return (
    <>
      {/* Mobile: top bar with the drawer trigger (pin concept is desktop-only). */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--muted)] px-4 py-3 md:hidden">
        <button
          type="button"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--foreground)] transition-colors hover:bg-[var(--background)]"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile: off-canvas drawer (closed on load, never persisted). */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <nav
            aria-label="Primary"
            className="absolute inset-y-0 left-0 flex w-[var(--nav-width)] max-w-[80%] flex-col bg-[var(--muted)] shadow-[var(--elevation-3)]"
            onKeyDown={(e) => {
              if (e.key === "Escape") setDrawerOpen(false);
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] p-4">
              <div className="min-w-0 flex-1">{header}</div>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setDrawerOpen(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--foreground)] transition-colors hover:bg-[var(--background)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto p-3">
              {topItems.length > 0 && (
                <div className="mb-2 space-y-1">
                  {renderLinks(topItems, {
                    forceLabels: true,
                    onNavigate: () => setDrawerOpen(false),
                  })}
                </div>
              )}
              {groupLabel && (
                <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  {groupLabel}
                </p>
              )}
              {renderLinks(items, {
                forceLabels: true,
                onNavigate: () => setDrawerOpen(false),
              })}
            </div>
            {footer && (
              <div className="border-t border-[var(--border)] p-4">{footer}</div>
            )}
          </nav>
        </div>
      )}

      {/* Desktop: in-flow dock (the only element that affects layout width) with
          the panel positioned inside it. Expanding the panel when unpinned
          overflows the dock as an overlay — the dock width never changes, so
          main content does not reflow. */}
      <div className="primary-nav-dock hidden md:block">
        <aside
          className={`primary-nav-panel ${expanded ? "is-expanded" : ""}`}
          onPointerEnter={openOverlay}
          onPointerLeave={closeOverlay}
          onFocus={() => {
            if (!pinned) {
              clearTimers();
              setExpanded(true);
            }
          }}
          onBlur={(e) => {
            if (
              !pinned &&
              !e.currentTarget.contains(e.relatedTarget as Node | null)
            ) {
              closeOverlay();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !pinned) {
              clearTimers();
              setExpanded(false);
            }
          }}
        >
          {header && (
            <div className="primary-nav-header border-b border-[var(--border)] p-4">
              {header}
            </div>
          )}

          <div className="flex justify-end px-3 pt-3">
            <button
              type="button"
              onClick={toggle}
              // Pressed state is derived client-side from the persisted value,
              // so it may differ from the SSR default for a returning user who
              // unpinned — suppress that benign single-attribute reconciliation.
              suppressHydrationWarning
              aria-pressed={pinned}
              aria-label="Pin/Unpin sidebar"
              aria-keyshortcuts="Meta+B Control+B"
              title="Pin/Unpin sidebar (⌘/Ctrl+B)"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)]"
            >
              {pinned ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </button>
          </div>

          <nav
            aria-label="Primary"
            className="flex-1 space-y-1 overflow-y-auto p-3"
          >
            {topItems.length > 0 && (
              <div className="mb-2 space-y-1">{renderLinks(topItems)}</div>
            )}
            {groupLabel && (
              <p className="primary-nav-label mb-2 px-3 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                {groupLabel}
              </p>
            )}
            {renderLinks(items)}
          </nav>

          {footer && (
            <div className="primary-nav-footer border-t border-[var(--border)] p-4">
              {footer}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
