import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { crmCollectionSegment } from "@adserve/crm";
import { getTenantContextOrNull } from "@/lib/permissions";
import { formatCurrency } from "@/lib/crm/dashboard";
import { loadCrmDashboardData } from "@/lib/crm/load-dashboard-data";

const CRM_ENTITY_SLUGS = ["account", "contact", "lead", "opportunity"] as const;
const LOCALE = "en-GB";

export default async function CrmDashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const ctx = await getTenantContextOrNull();
  if (!ctx) redirect("/dashboard");
  const { tenant, permissions } = ctx;

  const readableSlugs = CRM_ENTITY_SLUGS.filter((s) =>
    permissions.has(`${s}.read`)
  );
  const canPipeline = permissions.has("opportunity.read");
  const canLead = permissions.has("lead.read");
  const canActivities = permissions.has("activity.read");

  // No CRM visibility at all → fall back to the generic dashboard.
  if (readableSlugs.length === 0 && !canActivities) {
    redirect("/dashboard");
  }

  const data = await loadCrmDashboardData({
    tenantId: tenant.id,
    readableSlugs,
    canPipeline,
    canLead,
    canActivities,
  });

  const dateFmt = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium" });
  const pipelineMax = Math.max(1, ...data.pipeline.map((s) => s.total));
  const funnelMax = Math.max(1, ...data.funnel.map((s) => s.count));

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">CRM</h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Overview of your pipeline, upcoming tasks, and recent activity.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Widget 1 — Pipeline value by stage */}
        {canPipeline ? (
          <section className="rounded-xl border border-[var(--border)] p-6 lg:col-span-2">
            <h2 className="text-sm font-semibold tracking-tight">
              Pipeline value by stage
            </h2>
            {data.pipeline.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                No pipeline stages configured.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {data.pipeline.map((stage) => (
                  <li key={stage.slug}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">{stage.name}</span>
                      <span className="text-[var(--muted-foreground)]">
                        {formatCurrency(stage.total, LOCALE)} · {stage.count}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full rounded-full bg-[var(--muted)]">
                      <div
                        className="h-2 rounded-full bg-brand-500"
                        style={{ width: `${(stage.total / pipelineMax) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {/* Widget 4 — Lead conversion funnel */}
        {canLead ? (
          <section className="rounded-xl border border-[var(--border)] p-6">
            <h2 className="text-sm font-semibold tracking-tight">
              Lead conversion funnel
            </h2>
            {data.funnel.every((s) => s.count === 0) ? (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                No leads yet.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {data.funnel.map((stage) => (
                  <li key={stage.status}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">{stage.label}</span>
                      <span className="text-[var(--muted-foreground)]">
                        {stage.count}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full rounded-full bg-[var(--muted)]">
                      <div
                        className="h-2 rounded-full bg-brand-500"
                        style={{ width: `${(stage.count / funnelMax) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {/* Widget 5 — Weighted revenue forecast */}
        {canPipeline && data.forecast ? (
          <section className="rounded-xl border border-[var(--border)] p-6">
            <h2 className="text-sm font-semibold tracking-tight">
              Revenue forecast
            </h2>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Expected revenue (amount × probability) by close date.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                { label: "Next 30 days", value: data.forecast.next30 },
                { label: "Next 60 days", value: data.forecast.next60 },
                { label: "Next 90 days", value: data.forecast.next90 },
              ].map((w) => (
                <div key={w.label}>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {w.label}
                  </p>
                  <p className="mt-1 text-xl font-semibold">
                    {formatCurrency(w.value, LOCALE)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Widget 2 — Upcoming activities (next 7 days) */}
        {canActivities ? (
          <section className="rounded-xl border border-[var(--border)] p-6">
            <h2 className="text-sm font-semibold tracking-tight">
              Upcoming tasks (next 7 days)
            </h2>
            {data.upcoming.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                Nothing due in the next 7 days.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {data.upcoming.map((a) => {
                  const seg = crmCollectionSegment(a.recordSlug) ?? a.recordSlug;
                  return (
                    <li key={a.id} className="text-sm">
                      <Link
                        href={`/crm/${seg}/${a.recordId}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {a.subject ?? "(no subject)"}
                      </Link>
                      <span className="ml-2 text-[var(--muted-foreground)]">
                        {dateFmt.format(new Date(a.dueDate))} · {a.recordTitle}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        {/* Widget 3 — Recently modified records */}
        {readableSlugs.length > 0 ? (
          <section className="rounded-xl border border-[var(--border)] p-6">
            <h2 className="text-sm font-semibold tracking-tight">
              Recently modified
            </h2>
            {data.recent.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                No records yet.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {data.recent.map((r) => {
                  const seg = crmCollectionSegment(r.slug) ?? r.slug;
                  return (
                    <li key={r.id} className="flex items-baseline justify-between text-sm">
                      <Link
                        href={`/crm/${seg}/${r.id}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {r.title}
                      </Link>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {r.slug} · {dateFmt.format(new Date(r.updatedAt))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
