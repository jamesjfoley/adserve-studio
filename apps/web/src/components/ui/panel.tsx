import type { CSSProperties, ReactNode } from "react";

/**
 * Panel — the CRM design-system surface primitive (WS4).
 *
 * A pure presentational wrapper that applies the WS4 surface / elevation /
 * border / radius / padding tokens (declared in `globals.css`) to a single
 * elevated card. It optionally renders a header row from `title` / `actions`.
 *
 * Server-safe (locked criterion #17): this file imports ONLY `react` types —
 * no `postgres`, no `@adserve/database`, no DB client, no server action, no
 * secret. It is therefore neither `"use client"`-restricted nor
 * server-restricted; a server component (the CRM dashboard) and client
 * components (the CRM list / detail panels) can all import it. The ESLint
 * `boundary/no-server-in-client` rule never fires because no forbidden module
 * is imported here.
 *
 * No external dependency is used (no `clsx`): classes are joined with a plain
 * template string so introducing a primitive never introduces a dependency.
 */

type Elevation = 0 | 1 | 2 | 3;

interface PanelProps {
  children: ReactNode;
  /** Optional heading rendered in the panel header row. String or node. */
  title?: ReactNode;
  /** Optional right-aligned header slot (e.g. an "Add" button). */
  actions?: ReactNode;
  /** Elevation token to apply; default 1. */
  elevation?: Elevation;
  /** Compact padding (uses --panel-padding-sm). Default false. */
  compact?: boolean;
  /** Polymorphic root element. Defaults to "section". */
  as?: "section" | "div" | "aside";
  /** Escape hatch for layout classes (grid spans, margins) on the root. */
  className?: string;
  /** Forwarded to the root for assistive tech. */
  "aria-label"?: string;
}

/** Map the elevation prop onto its CSS-var box-shadow token. */
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

export function Panel({
  children,
  title,
  actions,
  elevation = 1,
  compact = false,
  as: As = "section",
  className,
  "aria-label": ariaLabel,
}: PanelProps) {
  const hasHeader = title != null || actions != null;

  const style: CSSProperties = {
    borderRadius: "var(--radius-panel)",
    borderWidth: "var(--border-width)",
    borderStyle: "solid",
    borderColor: "var(--panel-border)",
    backgroundColor: "var(--panel-bg)",
    padding: compact ? "var(--panel-padding-sm)" : "var(--panel-padding)",
    boxShadow: ELEVATION_VAR[elevation],
  };

  return (
    <As className={cx("adserve-panel", className)} style={style} aria-label={ariaLabel}>
      {hasHeader ? (
        <div className="flex items-center justify-between">
          {title != null ? (
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          ) : (
            <span />
          )}
          {actions != null ? <div>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </As>
  );
}
