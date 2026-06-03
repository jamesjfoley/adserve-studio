"use client";

import { useId, useRef, useState, type ReactNode } from "react";

export interface DetailTab {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * WS3 — accessible tab strip for the detail view. Implements the ARIA tabs
 * pattern: role="tablist"/"tab"/"tabpanel", aria-selected, roving tabindex, and
 * Left/Right/Home/End arrow-key navigation with focus management. Visual styling
 * uses the shared CSS-var conventions so WS4 can restyle without restructuring.
 */
export function DetailTabs({ tabs }: { tabs: DetailTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const baseId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function focusTab(id: string) {
    setActive(id);
    // Move focus to the newly-selected tab (roving tabindex pattern).
    requestAnimationFrame(() => tabRefs.current[id]?.focus());
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next !== null) {
      e.preventDefault();
      focusTab(tabs[next].id);
    }
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Record sections"
        className="flex gap-1 border-b border-[var(--border)]"
      >
        {tabs.map((tab, i) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={
                "rounded-t-md px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] " +
                (selected
                  ? "border-b-2 border-[var(--accent)] text-[var(--foreground)]"
                  : "border-b-2 border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]")
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={tab.id !== active}
          tabIndex={0}
          className="mt-6 focus:outline-none"
        >
          {tab.id === active ? tab.content : null}
        </div>
      ))}
    </div>
  );
}
