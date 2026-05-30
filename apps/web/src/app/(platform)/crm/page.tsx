import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import { entityTypes, withTenant } from "@adserve/database";
import { crmCollectionSegment } from "@adserve/crm";
import { getTenantContextOrNull } from "@/lib/permissions";
import {
  formatCurrency,
  pipelineValueByStage,
  recentlyModifiedRecords,
  upcomingActivities,
  type PipelineStageValue,
  type RecentRecord,
  type UpcomingActivity,
} from "@/lib/crm/dashboard";

const CRM_ENTITY_SLUGS = ["account", "contact", "lead", "opportunity"] as const;
const LOCALE = "en-GB";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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
  const canActivities = permissions.has("activity.read");

  // No CRM visibility at all → fall back to the generic dashboard.
  if (readableSlugs.length === 0 && !canActivities) {
    redirect("/dashboard");
  }

  const today = new Date();
  const weekOut = new Date(today);
  weekOut.setDate(weekOut.getDate() + 7);

  const data = await withTenant(tenant.id, async (tx) => {
    const types = await tx
      .select({
        id: entityTypes.id,
        slug: entityTypes.slug,
        settings: entityTypes.settings,
      })
      .from(entityTypes)
      .where(
        and(
          eq(entityTypes.tenantId, tenant.id),
          inArray(entityTypes.slug, [...CRM_ENTITY_SLUGS])
        )
      );

    const bySlug = new Map(types.map((t) => [t.slug, t]));
    const opportunity = bySlug.get("opportunity");

    // Entity types the caller may read — the permission boundary shared by
    // the upcoming-tasks and recently-modified widgets (a task/record must
    // not surface if its entity type isn't readable).
    const readableIds = readableSlugs
      .map((s) => bySlug.get(s)?.id)
      .filter((id): id is string => Boolean(id));

    let pipeline: PipelineStageValue[] = [];
    if (canPipeline && opportunity) {
      const stages =
        ((opportunity.settings as { pipelineStages?: { slug: string; name: string }[] })
          ?.pipelineStages ?? []).map((s) => ({ slug: s.slug, name: s.name }));
      pipeline = await pipelineValueByStage(tx, {
        tenantId: tenant.id,
        opportunityEntityTypeId: opportunity.id,
        stages,
      });
    }

    let upcoming: UpcomingActivity[] = [];
    if (canActivities) {
      upcoming = await upcomingActivities(tx, {
        tenantId: tenant.id,
        from: ymd(today),
        to: ymd(weekOut),
        entityTypeIds: readableIds,
      });
    }

    const recent: RecentRecord[] = await recentlyModifiedRecords(tx, {
      tenantId: tenant.id,
      entityTypeIds: readableIds,
    });

    return { pipeline, upcoming, recent };
  });

  const dateFmt = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium" });
  const pipelineMax = Math.max(1, ...data.pipeline.map((s) => s.total));

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
