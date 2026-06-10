import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, getTenantContextOrNull } from "@/lib/permissions";
import { readCrmModuleConfig } from "@/lib/crm/module-config";
import { type PipelineEntity, type PipelineFilters } from "@/lib/crm/pipeline";
import { loadPipelineData } from "@/lib/crm/load-pipeline-data";
import { PipelineBoard } from "./_components/pipeline-board";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Module guard before permission: Pipeline 404s when neither pipeline entity
  // is enabled, regardless of permissions.
  const pre = await getTenantContextOrNull();
  if (pre && !readCrmModuleConfig(pre.tenant.settings).showPipeline) notFound();

  // pipeline.read is the legacy/opportunity gate; it is also held by members
  // (alongside campaign.read), so it remains the route-level read gate.
  const ctx = await requirePermission("pipeline.read");
  const config = readCrmModuleConfig(ctx.tenant.settings);

  const sp = await searchParams;

  // Which board to show. Both enabled → switcher (?entity=, default campaign).
  // Exactly one enabled → that board directly. Boards are NEVER merged:
  // campaign and opportunity have distinct stage sets.
  const requested = str(sp.entity);
  let entity: PipelineEntity;
  if (config.campaigns && config.opportunities) {
    entity = requested === "opportunity" ? "opportunity" : "campaign";
  } else if (config.campaigns) {
    entity = "campaign";
  } else {
    entity = "opportunity";
  }
  const showSwitcher = config.campaigns && config.opportunities;

  // Stage moves authorize per entity: campaigns on campaign.update (the generic
  // PATCH route's gate), opportunities on the legacy pipeline.update.
  const canMove =
    entity === "campaign"
      ? ctx.permissions.has("campaign.update")
      : ctx.permissions.has("pipeline.update");

  const filters: PipelineFilters = {
    owner: str(sp.owner),
    accountId: str(sp.accountId),
    closeDateFrom: str(sp.closeDateFrom),
    closeDateTo: str(sp.closeDateTo),
  };

  const data = await loadPipelineData({
    tenantId: ctx.tenant.id,
    entity,
    filters,
  });

  if (!data.board) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <p className="mt-4 text-[var(--muted-foreground)]">
          The CRM module is not active for this tenant.
        </p>
      </div>
    );
  }

  return (
    <div>
      {showSwitcher ? (
        <div className="mb-4 inline-flex rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-1 text-sm">
          {(
            [
              { key: "campaign", label: "Campaigns" },
              { key: "opportunity", label: "Opportunities" },
            ] as { key: PipelineEntity; label: string }[]
          ).map((tab) => {
            const active = tab.key === entity;
            return (
              <Link
                key={tab.key}
                href={`/crm/pipeline?entity=${tab.key}`}
                className={`rounded-md px-3 py-1 font-medium transition ${
                  active
                    ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      ) : null}

      <PipelineBoard
        entity={entity}
        columns={data.board.columns}
        currency={data.board.currency}
        members={data.members}
        accounts={data.accounts}
        filters={filters}
        canMove={canMove}
        locale="en-GB"
      />
    </div>
  );
}
