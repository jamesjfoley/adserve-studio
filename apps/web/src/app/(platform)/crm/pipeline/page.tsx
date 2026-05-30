import { and, asc, eq } from "drizzle-orm";
import { entityTypes, records, withTenant } from "@adserve/database";
import { requirePermission } from "@/lib/permissions";
import { listActiveMembers } from "@/lib/crm/members";
import { loadPipelineBoard, type PipelineFilters } from "@/lib/crm/pipeline";
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

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const board = await loadPipelineBoard(tx, {
      tenantId: ctx.tenant.id,
      filters,
    });
    const members = await listActiveMembers(tx, ctx.tenant.id);

    // Accounts for the filter dropdown.
    const [accountType] = await tx
      .select({ id: entityTypes.id })
      .from(entityTypes)
      .where(
        and(
          eq(entityTypes.tenantId, ctx.tenant.id),
          eq(entityTypes.slug, "account")
        )
      );
    const accountRows = accountType
      ? await tx
          .select({ id: records.id, data: records.data })
          .from(records)
          .where(
            and(
              eq(records.tenantId, ctx.tenant.id),
              eq(records.entityTypeId, accountType.id),
              eq(records.isArchived, false)
            )
          )
          .orderBy(asc(records.createdAt))
      : [];
    const accounts = accountRows
      .map((r) => ({
        id: r.id,
        name:
          typeof (r.data as Record<string, unknown>)?.name === "string"
            ? ((r.data as Record<string, unknown>).name as string)
            : r.id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { board, members, accounts };
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
