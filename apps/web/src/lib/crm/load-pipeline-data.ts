import { and, asc, eq } from "drizzle-orm";
import { entityTypes, records, withTenant } from "@adserve/database";
import { listActiveMembers, type TenantMember } from "./members";
import {
  loadPipelineBoard,
  type PipelineBoardData,
  type PipelineEntity,
  type PipelineFilters,
} from "./pipeline";

export interface PipelineAccount {
  id: string;
  name: string;
}

export interface PipelinePageData {
  board: PipelineBoardData | null;
  members: TenantMember[];
  accounts: PipelineAccount[];
}

/**
 * Server-side data path for the pipeline kanban (/crm/pipeline). Extracted
 * from the page so it is testable under enforced RLS (owns the withTenant call).
 */
export async function loadPipelineData(args: {
  tenantId: string;
  entity?: PipelineEntity;
  filters?: PipelineFilters;
}): Promise<PipelinePageData> {
  const { tenantId, entity = "opportunity", filters = {} } = args;

  return withTenant(tenantId, async (tx) => {
    const board = await loadPipelineBoard(tx, { tenantId, entity, filters });
    const members = await listActiveMembers(tx, tenantId);

    const [accountType] = await tx
      .select({ id: entityTypes.id })
      .from(entityTypes)
      .where(and(eq(entityTypes.tenantId, tenantId), eq(entityTypes.slug, "account")));

    const accountRows = accountType
      ? await tx
          .select({ id: records.id, data: records.data })
          .from(records)
          .where(
            and(
              eq(records.tenantId, tenantId),
              eq(records.entityTypeId, accountType.id),
              eq(records.isArchived, false)
            )
          )
          .orderBy(asc(records.createdAt))
      : [];

    const accounts: PipelineAccount[] = accountRows
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
}
