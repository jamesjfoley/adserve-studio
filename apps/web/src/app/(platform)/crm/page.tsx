import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { crmCollectionSegment } from "@adserve/crm";
import { getTenantContextOrNull } from "@/lib/permissions";
import { readCrmModuleConfig } from "@/lib/crm/module-config";
import { formatCurrency } from "@/lib/crm/dashboard";
import { loadCrmDashboardData } from "@/lib/crm/load-dashboard-data";
import { Panel } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";

const CRM_ENTITY_SLUGS = ["account", "contact", "lead", "opportunity"] as const;
const LOCALE = "en-GB";

export default async function CrmDashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const ctx = await getTenantContextOrNull();
  if (!ctx) redirect("/dashboard");
  const { tenant, permissions } = ctx;

  // The CRM dashboard appears only when a pipeline entity is enabled
  // (showPipeline). Disabled → 404, consistent with the nav + Pipeline route.
  if (!readCrmModuleConfig(tenant.settings).showPipeline) notFound();

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

  // KPI tiles derived from the loaded data (only those the user can see).
  const pipelineValue = data.pipeline.reduce((sum, s) => sum + s.total, 0);
  const openOpps = data.pipeline.reduce((sum, s) => sum + s.count, 0);
  const totalLeads = data.funnel.reduce((sum, s) => sum + s.count, 0);
  const kpis: { label: string; value: string; sub?: string }[] = [];
  if (canPipeline) {
    kpis.push({
      label: "Pipeline value",
      value: formatCurrency(pipelineValue, LOCALE),
      sub: `${openOpps} open ${openOpps === 1 ? "opportunity" : "opportunities"}`,
    });
  }
  if (canPipeline && data.forecast) {
    kpis.push({
      label: "Forecast · 90 days",
      value: formatCurrency(data.forecast.next90, LOCALE),
      sub: "Weighted by probability",
    });
  }
  if (canLead) {
    kpis.push({
      label: "Leads",
      value: String(totalLeads),
      sub: "Across the funnel",
    });
  }
  if (canActivities) {
    kpis.push({
      label: "Due next 7 days",
      value: String(data.upcoming.length),
      sub: "Upcoming tasks",
    });
  }

  return (
    <div>
      <PageHeader
        title="CRM"
        subtitle="Overview of your pipeline, upcoming tasks, and recent activity."
      />

      {kpis.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => (
            <StatCard key={k.label} label={k.label} value={k.value} sub={k.sub} />
          ))}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Widget 1 — Pipeline value by stage */}
        {canPipeline ? (
          <Panel title="Pipeline value by stage" className="lg:col-span-2">
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
                        className="h-2 rounded-full bg-[var(--accent)]"
                        style={{ width: `${(stage.total / pipelineMax) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}

        {/* Widget 4 — Lead conversion funnel */}
        {canLead ? (
          <Panel title="Lead conversion funnel">
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
                        className="h-2 rounded-full bg-[var(--accent)]"
                        style={{ width: `${(stage.count / funnelMax) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}

        {/* Widget 5 — Weighted revenue forecast */}
        {canPipeline && data.forecast ? (
          <Panel title="Revenue forecast">
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
          </Panel>
        ) : null}

        {/* Widget 2 — Upcoming activities (next 7 days) */}
        {canActivities ? (
          <Panel title="Upcoming tasks (next 7 days)">
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
                        className="font-medium text-[var(--accent)] hover:underline"
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
          </Panel>
        ) : null}

        {/* Widget 3 — Recently modified records */}
        {readableSlugs.length > 0 ? (
          <Panel title="Recently modified">
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
                        className="font-medium text-[var(--accent)] hover:underline"
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
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
