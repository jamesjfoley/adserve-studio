import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * PageHeader — the standard page/record header below the app top bar.
 *
 * Layout: an optional square back-arrow button, vertically CENTRED against the
 * label stack, then the label stack itself — a small uppercase eyebrow
 * ("ACCOUNT") directly above the title row, where the bold title and an
 * optional status pill sit on one centred baseline. Right-aligned actions
 * balance the row. Server-safe (react types only).
 */
export function PageHeader({
  eyebrow,
  title,
  status,
  subtitle,
  actions,
  backHref,
  backLabel = "Back",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** A pill/badge shown beside the title (e.g. a StatusPill). */
  status?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** When set, a back-arrow icon link to this href is shown left of the title. */
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {backHref != null ? (
          <Link
            href={backHref}
            aria-label={backLabel}
            title={backLabel}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </Link>
        ) : null}
        <div className="min-w-0">
          {eyebrow != null ? (
            <p className="text-[11px] font-semibold uppercase leading-none tracking-[0.08em] text-[var(--muted-foreground)]">
              {eyebrow}
            </p>
          ) : null}
          <div className="mt-1 flex items-center gap-2.5">
            <h1 className="truncate text-2xl font-semibold leading-tight tracking-tight text-[var(--foreground)]">
              {title}
            </h1>
            {status != null ? <span className="shrink-0">{status}</span> : null}
          </div>
          {subtitle != null ? (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {actions != null ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
