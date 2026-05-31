/**
 * Client-safe CRM presentation helpers. Deliberately free of any
 * `@adserve/database` import so client components (e.g. the pipeline board)
 * can use these without dragging the server-only `postgres` driver into the
 * browser bundle. Server-side `dashboard.ts` re-exports `formatCurrency` for
 * back-compat.
 */

/** Format a numeric amount as a localized currency string (pure). */
export function formatCurrency(
  amount: number,
  locale: string,
  currency = "GBP"
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
