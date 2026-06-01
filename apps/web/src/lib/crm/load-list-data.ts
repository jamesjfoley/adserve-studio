import { asc, desc, sql } from "drizzle-orm";
import { records, withTenant } from "@adserve/database";
import type { FieldDefinitionWithLabels, LayoutConfig } from "@adserve/module-framework";
import {
  buildOrderBy,
  buildWhere,
  resolveOwnerFilter,
  type ParsedListParams,
} from "./query";
import { loadEntityForm } from "./load-entity-form";
import { listActiveMembers, type TenantMember } from "./members";

export interface CrmListData {
  fields: FieldDefinitionWithLabels[];
  rows: (typeof records.$inferSelect)[];
  total: number;
  layoutConfig: LayoutConfig;
  members: TenantMember[];
}

/**
 * Server-side data path for the CRM list page (/crm/[entityType]).
 *
 * Extracted from the page component so it is testable under enforced RLS
 * (hardening step 2). It owns the `withTenant()` call — the tenant context
 * the page relies on — so a test exercising this function proves the page
 * actually establishes RLS context (not just that a query happens to filter
 * by an explicit predicate). Returns null when the entity type isn't
 * activated for the tenant (→ the page 404s).
 */
export async function loadCrmListData(args: {
  tenantId: string;
  slug: string;
  parsed: ParsedListParams;
  userId: string;
}): Promise<CrmListData | null> {
  const { tenantId, slug, parsed, userId } = args;
  const ownerFilter = resolveOwnerFilter(parsed.owner, userId);

  return withTenant(tenantId, async (tx) => {
    const bundle = await loadEntityForm(tx, { tenantId, slug });
    if (!bundle) return null;
    const { entity, fields, layoutConfig } = bundle;

    let where;
    let orderBy;
    try {
      where = buildWhere(
        tenantId,
        entity.id,
        fields,
        parsed.filters,
        parsed.includeArchived,
        ownerFilter
      );
      orderBy = buildOrderBy(fields, parsed.sort);
    } catch {
      // A filter/sort that doesn't apply to this entity → safe default view.
      where = buildWhere(
        tenantId,
        entity.id,
        fields,
        [],
        parsed.includeArchived,
        ownerFilter
      );
      orderBy = null;
    }

    const members = await listActiveMembers(tx, tenantId);

    const order = orderBy
      ? [orderBy, asc(records.id)]
      : [desc(records.createdAt), asc(records.id)];

    const rows = await tx
      .select()
      .from(records)
      .where(where)
      .orderBy(...order)
      .limit(parsed.limit)
      .offset(parsed.offset);

    const [countRow] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(records)
      .where(where);

    return { fields, rows, total: countRow?.total ?? 0, layoutConfig, members };
  });
}
