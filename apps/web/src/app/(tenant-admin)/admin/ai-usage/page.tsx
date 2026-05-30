import { aiUsageLog, withTenant } from "@adserve/database";
import { getCurrentPeriodSummary, getUsageLimits } from "@adserve/ai-service";
import { and, desc, eq, gte } from "drizzle-orm";
import { requirePermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** Microdollars → "$X.XX". Cost is billed in USD; GBP display deferred. */
function formatUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

type BreakdownEntry = { tokens?: number; costMicros?: number; count?: number };

export default async function TenantAiUsagePage() {
  const ctx = await requirePermission("ai_usage.read");
  const tenantId = ctx.tenant.id;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);

  const { summary, limits, recent } = await withTenant(tenantId, async (tx) => {
    const summary = await getCurrentPeriodSummary({ tenantId }, tx);
    const limits = await getUsageLimits({ tenantId }, tx);
    const recent = await tx
      .select()
      .from(aiUsageLog)
      .where(
        and(eq(aiUsageLog.tenantId, tenantId), gte(aiUsageLog.createdAt, since))
      )
      .orderBy(desc(aiUsageLog.createdAt))
      .limit(50);
    return { summary, limits, recent };
  });

  const usedMicros = summary?.totalCostMicros ?? 0;
  const capMicros = limits?.monthlyCostLimitMicros ?? null;
  const remainingMicros =
    capMicros != null ? Math.max(0, capMicros - usedMicros) : null;

  const cards = [
    {
      label: "Spend this month",
      value: formatUsd(usedMicros),
      description: "Current calendar month (USD)",
    },
    {
      label: "Monthly cap",
      value: capMicros != null ? formatUsd(capMicros) : "—",
      description: "Set by AdServe",
    },
    {
      label: "Remaining",
      value: remainingMicros != null ? formatUsd(remainingMicros) : "—",
      description: "Until calls are blocked",
    },
    {
      label: "Requests",
      value: summary?.requestCount ?? 0,
      description: "Successful AI calls this month",
    },
  ];

  const breakdown = Object.entries(
    (summary?.breakdown ?? {}) as Record<string, BreakdownEntry>
  ).sort((a, b) => (b[1].costMicros ?? 0) - (a[1].costMicros ?? 0));

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">AI usage</h1>
      <p className="mt-2 text-[var(--muted-foreground)]">
        Your tenant&apos;s AI consumption for the current month. Costs are
        estimated in US dollars.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6"
          >
            <p className="text-sm font-medium text-[var(--muted-foreground)]">
              {card.label}
            </p>
            <p className="mt-2 text-3xl font-semibold">{card.value}</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {card.description}
            </p>
          </div>
        ))}
      </div>

      <section className="mt-12">
        <h2 className="text-lg font-semibold tracking-tight">
          By capability
        </h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
              <tr>
                <th className="px-4 py-3 font-medium">Module / capability</th>
                <th className="px-4 py-3 font-medium">Requests</th>
                <th className="px-4 py-3 font-medium">Tokens</th>
                <th className="px-4 py-3 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {breakdown.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-[var(--muted-foreground)]"
                  >
                    No AI usage yet this month.
                  </td>
                </tr>
              )}
              {breakdown.map(([key, e]) => (
                <tr key={key}>
                  <td className="px-4 py-3 font-mono text-xs">{key}</td>
                  <td className="px-4 py-3">{e.count ?? 0}</td>
                  <td className="px-4 py-3">{e.tokens ?? 0}</td>
                  <td className="px-4 py-3">{formatUsd(e.costMicros ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold tracking-tight">Recent calls</h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Capability</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Tokens</th>
                <th className="px-4 py-3 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {recent.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-[var(--muted-foreground)]"
                  >
                    No calls in the last 30 days.
                  </td>
                </tr>
              )}
              {recent.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {new Date(row.createdAt).toLocaleString("en-GB")}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {row.module}.{row.capability}
                  </td>
                  <td className="px-4 py-3">{row.status}</td>
                  <td className="px-4 py-3">{row.totalTokens}</td>
                  <td className="px-4 py-3">{formatUsd(row.costMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
