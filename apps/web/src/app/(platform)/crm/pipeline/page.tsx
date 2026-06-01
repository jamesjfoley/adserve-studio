import { requirePermission } from "@/lib/permissions";
import { type PipelineFilters } from "@/lib/crm/pipeline";
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
  const ctx = await requirePermission("pipeline.read");
  const canMove = ctx.permissions.has("pipeline.update");

  const sp = await searchParams;
  const filters: PipelineFilters = {
    owner: str(sp.owner),
    accountId: str(sp.accountId),
    closeDateFrom: str(sp.closeDateFrom),
    closeDateTo: str(sp.closeDateTo),
  };

  const data = await loadPipelineData({ tenantId: ctx.tenant.id, filters });

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
    <PipelineBoard
      columns={data.board.columns}
      currency={data.board.currency}
      members={data.members}
      accounts={data.accounts}
      filters={filters}
      canMove={canMove}
      locale="en-GB"
    />
  );
}
