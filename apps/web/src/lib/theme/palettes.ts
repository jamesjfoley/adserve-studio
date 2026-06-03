/**
 * WS6 — admin-selectable per-org palette catalog.
 *
 * Pure data + validation, with NO database or server-only import, so it is
 * usable from the server layout (apply), the client picker (write), and tests
 * alike (§3 server/client boundary).
 *
 * Each palette overrides ONLY the WS4 colour-accent seam tokens
 * (`--accent` / `--accent-foreground`) — never spacing/type. The `accent`
 * values here are mirrored by the `[data-palette="<id>"]` rules in globals.css
 * (kept in sync; a test asserts the foreground is the WCAG-AA white on each).
 */

export const PALETTE_IDS = ["grey-blue", "slate", "emerald", "violet"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

/** Default when a tenant's setting is unset or unknown. */
export const DEFAULT_PALETTE: PaletteId = "grey-blue";

export interface PaletteMeta {
  id: PaletteId;
  label: string;
  /** The palette's `--accent` value — kept in sync with globals.css. */
  accent: string;
  /** The palette's `--accent-foreground` value (WCAG-AA on `accent`). */
  accentForeground: string;
}

export const PALETTES: Record<PaletteId, PaletteMeta> = {
  "grey-blue": {
    id: "grey-blue",
    label: "Grey-blue",
    accent: "#185fa5",
    accentForeground: "#ffffff",
  },
  slate: {
    id: "slate",
    label: "Slate",
    accent: "#334155",
    accentForeground: "#ffffff",
  },
  emerald: {
    id: "emerald",
    label: "Emerald",
    accent: "#047857",
    accentForeground: "#ffffff",
  },
  violet: {
    id: "violet",
    label: "Violet",
    accent: "#6d28d9",
    accentForeground: "#ffffff",
  },
};

export function isPaletteId(value: unknown): value is PaletteId {
  return (
    typeof value === "string" &&
    (PALETTE_IDS as readonly string[]).includes(value)
  );
}

/** Validate a raw value to a known palette id; unknown/absent → the default. */
export function resolvePaletteId(value: unknown): PaletteId {
  return isPaletteId(value) ? value : DEFAULT_PALETTE;
}

/**
 * Read the palette from a tenant's `settings` JSONB (`settings.theme.palette`),
 * falling back to the default for unset/unknown. Accepts `unknown` because the
 * `tenants.settings` column is untyped JSONB.
 */
export function readTenantPalette(settings: unknown): PaletteId {
  const theme = (
    settings as { theme?: { palette?: unknown } } | null | undefined
  )?.theme;
  return resolvePaletteId(theme?.palette);
}
