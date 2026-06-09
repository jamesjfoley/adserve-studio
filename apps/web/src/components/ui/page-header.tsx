import type { ReactNode } from "react";

/**
 * PageHeader — the standard page/record header below the app top bar (per the
 * style guides): an optional uppercase eyebrow ("CONTACT"), a large bold title
 * with an optional inline status, an optional subtitle, and right-aligned
 * actions (secondary outline buttons + a primary CTA). Server-safe.
 */
export function PageHeader({
  eyebrow,
  title,
  status,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Rendered inline after the title in muted weight, e.g. "(Active)". */
  status?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow != null ? (
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-0.5 flex items-center gap-2 truncate text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          {title}
          {status != null ? (
            <span className="text-base font-normal text-[var(--muted-foreground)]">
              {status}
            </span>
          ) : null}
        </h1>
        {subtitle != null ? (
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{subtitle}</p>
        ) : null}
      </div>
      {actions != null ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
