"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";

/**
 * CollapsiblePanel — a client-side, collapsible variant of the design-system
 * Panel surface.
 *
 * The base `Panel` (`@/components/ui/panel`) is intentionally server-safe (no
 * `"use client"`, no hooks) so it can render inside server components without
 * tripping the `boundary/no-server-in-client` gate. Collapse needs `useState`,
 * which would force `"use client"` onto Panel and that boundary. To keep Panel
 * untouched we ship the collapsible behaviour as this thin client wrapper.
 *
 * Visuals mirror Panel exactly — same token-driven surface (border, radius,
 * background, elevation) and the same tinted header band — so a collapsible
 * section is indistinguishable from a static one apart from the chevron toggle.
 *
 * Accessibility:
 *   - The toggle is a real `<button aria-expanded …>` wired to the body via
 *     `aria-controls`.
 *   - When closed the body is removed from the DOM, so collapsed content is
 *     hidden from layout AND assistive tech; the header band stays visible.
 */

type Elevation = 0 | 1 | 2 | 3;

interface CollapsiblePanelProps {
  children: ReactNode;
  /** Heading rendered in the header band. */
  title?: ReactNode;
  /** Right-aligned header-band slot (e.g. an "Add" button). */
  actions?: ReactNode;
  /** Elevation token to apply; default 1. */
  elevation?: Elevation;
  /** Compact padding (uses --panel-padding-sm). Default false. */
  compact?: boolean;
  /** Polymorphic root element. Defaults to "section". */
  as?: "section" | "div" | "aside";
  /** Layout-only escape hatch for the ROOT (grid spans, margins, flex). */
  className?: string;
  /** Layout-only escape hatch for the BODY wrapper. */
  bodyClassName?: string;
  /** Forwarded to the root for assistive tech. */
  "aria-label"?: string;
  /** When true, the header shows a chevron toggle and the body can hide. */
  collapsible?: boolean;
  /** Initial open state when collapsible. Default true. */
  defaultOpen?: boolean;
}

const ELEVATION_VAR: Record<Elevation, string> = {
  0: "var(--elevation-0)",
  1: "var(--elevation-1)",
  2: "var(--elevation-2)",
  3: "var(--elevation-3)",
};

/** Join class fragments, dropping falsy entries. Avoids a clsx dependency. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transition: "transform 150ms ease",
        transform: open ? "rotate(0deg)" : "rotate(-90deg)",
        color: "var(--muted-foreground)",
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function CollapsiblePanel({
  children,
  title,
  actions,
  elevation = 1,
  compact = false,
  as: As = "section",
  className,
  bodyClassName,
  "aria-label": ariaLabel,
  collapsible = false,
  defaultOpen = true,
}: CollapsiblePanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  const hasHeader = title != null || actions != null || collapsible;
  const pad = compact ? "var(--panel-padding-sm)" : "var(--panel-padding)";

  const rootStyle: CSSProperties = {
    borderRadius: "var(--radius-panel)",
    borderWidth: "var(--border-width)",
    borderStyle: "solid",
    borderColor: "var(--panel-border)",
    backgroundColor: "var(--panel-bg)",
    boxShadow: ELEVATION_VAR[elevation],
    overflow: "hidden", // clip the header band to the panel radius
  };

  const headerStyle: CSSProperties = {
    backgroundColor: "var(--panel-header-bg)",
    borderBottom: open
      ? "var(--border-width) solid var(--panel-border)"
      : "none",
    paddingInline: pad,
    paddingTop: "var(--space-3)",
    paddingBottom: "var(--space-3)",
  };

  const titleNode =
    title != null ? (
      <h2 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
        {title}
      </h2>
    ) : (
      <span />
    );

  return (
    <As className={cx("adserve-panel", className)} style={rootStyle} aria-label={ariaLabel}>
      {hasHeader ? (
        <div className="flex items-center justify-between gap-3" style={headerStyle}>
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={bodyId}
              className="flex flex-1 items-center gap-2 text-left"
            >
              <Chevron open={open} />
              {titleNode}
            </button>
          ) : (
            titleNode
          )}
          {actions != null ? (
            <div className="flex items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {open ? (
        <div id={bodyId} className={bodyClassName} style={{ padding: pad }}>
          {children}
        </div>
      ) : null}
    </As>
  );
}
