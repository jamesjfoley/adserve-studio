import type { CSSProperties, ReactNode } from "react";

/**
 * Panel — the CRM design-system surface primitive.
 *
 * A white (token-driven) card that sits on the soft-grey page background. When
 * given a `title`/`actions` it renders a distinct **header band** (tinted +
 * bottom border) above a padded body — the house section style seen across the
 * style guides ("Deal Details", "Discounts", …). With neither, it's a bare
 * padded surface.
 *
 * Server-safe: imports ONLY `react` types — no DB/secret/server module — so it
 * works in both server and client components (the boundary rule never fires).
 */

type Elevation = 0 | 1 | 2 | 3;

interface PanelProps {
  children: ReactNode;
  /** Heading rendered in the header band. */
  title?: ReactNode;
  /** Right-aligned header-band slot (e.g. an "Add" button). */
  actions?: ReactNode;
  /** Elevation token to apply; default 1. */
  elevation?: Elevation;
  /** Compact padding (uses --panel-padding-sm). Default false. */
  compact?: boolean;
  /** Slimmer header band (reduced vertical padding) — for data-dense panels
   * whose header carries inline controls. Default false. */
  denseHeader?: boolean;
  /** Polymorphic root element. Defaults to "section". */
  as?: "section" | "div" | "aside";
  /** Layout-only escape hatch for the ROOT (grid spans, margins, flex). */
  className?: string;
  /** Layout-only escape hatch for the BODY wrapper (e.g. flex for fill-height). */
  bodyClassName?: string;
  /** Forwarded to the root for assistive tech. */
  "aria-label"?: string;
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

export function Panel({
  children,
  title,
  actions,
  elevation = 1,
  compact = false,
  denseHeader = false,
  as: As = "section",
  className,
  bodyClassName,
  "aria-label": ariaLabel,
}: PanelProps) {
  const hasHeader = title != null || actions != null;
  const pad = compact ? "var(--panel-padding-sm)" : "var(--panel-padding)";
  const headerPadBlock = denseHeader ? "var(--space-2)" : "var(--space-3)";

  const rootStyle: CSSProperties = {
    borderRadius: "var(--radius-panel)",
    borderWidth: "var(--border-width)",
    borderStyle: "solid",
    borderColor: "var(--panel-border)",
    backgroundColor: "var(--panel-bg)",
    boxShadow: ELEVATION_VAR[elevation],
    overflow: "hidden", // clip the header band to the panel radius
  };

  return (
    <As className={cx("adserve-panel", className)} style={rootStyle} aria-label={ariaLabel}>
      {hasHeader ? (
        <div
          className="flex items-center justify-between gap-3"
          style={{
            backgroundColor: "var(--panel-header-bg)",
            borderBottom: "var(--border-width) solid var(--panel-border)",
            paddingInline: pad,
            paddingTop: headerPadBlock,
            paddingBottom: headerPadBlock,
          }}
        >
          {title != null ? (
            <h2 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions != null ? (
            <div className="flex items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={bodyClassName} style={{ padding: pad }}>
        {children}
      </div>
    </As>
  );
}
