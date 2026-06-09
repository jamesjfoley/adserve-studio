import type { ReactNode } from "react";
import { Panel } from "./panel";

/**
 * StatCard — a KPI tile (small uppercase label, big value, optional sub-detail),
 * per the dashboard style guide. A bare `Panel` surface; server-safe.
 */
export function StatCard({
  label,
  value,
  sub,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <Panel compact>
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
        {value}
      </p>
      {sub != null ? (
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">{sub}</p>
      ) : null}
    </Panel>
  );
}
