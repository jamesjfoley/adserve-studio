import type { ReactNode } from "react";

/**
 * StatusPill — the house status chip (soft tinted bg + readable fg), driven by
 * the `--status-*` tokens so it flips in dark mode. Server-safe (react types
 * only). Pass an explicit `tone`, or a `status` string and let `statusTone`
 * map it.
 */
export type StatusTone = "success" | "info" | "warning" | "neutral";

/** Map a CRM status string to a pill tone. Unknown → neutral. */
export function statusTone(status: string | null | undefined): StatusTone {
  const s = (status ?? "").trim().toLowerCase();
  if (["active", "completed", "won", "approved", "paid"].includes(s)) {
    return "success";
  }
  if (
    ["prospect", "running", "open", "new", "converted", "qualification", "in progress"].includes(
      s
    )
  ) {
    return "info";
  }
  if (["booked", "pending", "draft", "on hold", "warning"].includes(s)) {
    return "warning";
  }
  return "neutral"; // inactive, lost, closed, archived, unknown
}

export function StatusPill({
  status,
  tone,
  children,
}: {
  status?: string | null;
  tone?: StatusTone;
  children?: ReactNode;
}) {
  const t = tone ?? statusTone(status);
  const label =
    children ??
    (status
      ? status.charAt(0).toUpperCase() + status.slice(1)
      : "");
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `var(--status-${t}-bg)`,
        color: `var(--status-${t}-fg)`,
      }}
    >
      {label}
    </span>
  );
}
