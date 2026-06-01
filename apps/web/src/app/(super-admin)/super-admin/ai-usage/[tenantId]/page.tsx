import Link from "next/link";
import { notFound } from "next/navigation";
import { DEFAULT_MONTHLY_COST_LIMIT_MICROS } from "@adserve/ai-service";
import { requireSuperAdmin } from "@/lib/super-admin";
import { loadSuperAdminAiUsageDetail } from "@/lib/super-admin/loaders";
import { LimitEditor } from "./limit-editor";

export const dynamic = "force-dynamic";

function formatUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

type Params = { params: Promise<{ tenantId: string }> };

export default async function SuperAdminTenantAiUsagePage({ params }: Params) {
  await requireSuperAdmin();
  const { tenantId } = await params;

  const data = await loadSuperAdminAiUsageDetail(tenantId);

  if (!data) notFound();
  const { tenant, summary, limits, recent } = data;
  const capMicros =
    limits?.monthlyCostLimitMicros ?? DEFAULT_MONTHLY_COST_LIMIT_MICROS;

  return (
    <div>
      <Link
        href="/super-admin/ai-usage"
        className="text-sm text-[var(--muted-foreground)] hover:underline"
      >
        ← All tenants
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {tenant.name} — AI usage
      </h1>
      <p className="mt-1 text-[var(--muted-foreground)]">
        Current month. Costs in USD.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6">
          <p className="text-sm font-medium text-[var(--muted-foreground)]">
            Spend this month
          </p>
          <p className="mt-2 text-3xl font-semibold">
            {formatUsd(summary?.totalCostMicros ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6">
          <p className="text-sm font-medium text-[var(--muted-foreground)]">
            Requests
          </p>
          <p className="mt-2 text-3xl font-semibold">
            {summary?.requestCount ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6">
          <p className="text-sm font-medium text-[var(--muted-foreground)]">
            Tokens
          </p>
          <p className="mt-2 text-3xl font-semibold">
            {summary?.totalTokens ?? 0}
          </p>
        </div>
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Usage cap</h2>
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-6">
          <LimitEditor tenantId={tenant.id} initialCostMicros={capMicros} />
        </div>
      </section>

      <section className="mt-10">
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
