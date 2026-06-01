import Link from "next/link";
import { currentPeriod } from "@adserve/ai-service";
import { requireSuperAdmin } from "@/lib/super-admin";
import { loadSuperAdminAiUsageList } from "@/lib/super-admin/loaders";

export const dynamic = "force-dynamic";

function formatUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

export default async function SuperAdminAiUsagePage() {
  await requireSuperAdmin();
  const { start } = currentPeriod(); // presentation-only period label

  const rows = await loadSuperAdminAiUsageList();

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">AI usage</h1>
      <p className="mt-2 text-[var(--muted-foreground)]">
        Platform-wide AI spend for the current month ({start}). Costs in USD.
      </p>

      <div className="mt-8 overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-3 font-medium">Tenant</th>
              <th className="px-4 py-3 font-medium">Spend</th>
              <th className="px-4 py-3 font-medium">Cap</th>
              <th className="px-4 py-3 font-medium">Requests</th>
              <th className="px-4 py-3 font-medium">Tokens</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-[var(--muted-foreground)]"
                >
                  No tenants yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.tenantId} className="hover:bg-[var(--muted)]/50">
                <td className="px-4 py-3 font-medium">
                  <Link
                    href={`/super-admin/ai-usage/${r.tenantId}`}
                    className="hover:underline"
                  >
                    {r.tenantName}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {formatUsd(r.totalCostMicros ?? 0)}
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {r.monthlyCostLimitMicros != null
                    ? formatUsd(r.monthlyCostLimitMicros)
                    : "—"}
                </td>
                <td className="px-4 py-3">{r.requestCount ?? 0}</td>
                <td className="px-4 py-3">{r.totalTokens ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
