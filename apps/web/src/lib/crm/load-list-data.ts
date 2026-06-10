import { and, asc, desc, sql } from "drizzle-orm";
import { records, withTenant } from "@adserve/database";
import type { FieldDefinitionWithLabels, LayoutConfig } from "@adserve/module-framework";
import { isTextFilterable } from "@/components/dynamic-table/operators";
import {
  buildOrderBy,
  buildWhere,
  resolveOwnerFilter,
  type ParsedListParams,
} from "./query";
import { loadEntityForm } from "./load-entity-form";
import { listActiveMembers, type TenantMember } from "./members";

/**
 * Per-column distinct values for the header value-picker. A column appears
 * here ONLY when it is "intelligently filterable": a text-value column with
 * ≥2 distinct values where at least one repeats. That single rule both
 * excludes always-unique columns (email, phone, free-text) and one-value
 * columns, and includes repeating categorical text. Values are alphabetical.
 */
export type ColumnFacets = Record<string, string[]>;

export interface CrmListData {
  fields: FieldDefinitionWithLabels[];
  rows: (typeof records.$inferSelect)[];
  total: number;
  layoutConfig: LayoutConfig;
  members: TenantMember[];
  facets: ColumnFacets;
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

    // Facets are computed over the BASE domain (tenant + entity + archived +
    // owner) — deliberately ignoring the active column filters, so the
    // picklist always offers the full set of values for the current view.
    const baseWhere = buildWhere(
      tenantId,
      entity.id,
      fields,
      [],
      parsed.includeArchived,
      ownerFilter
    );

    const facets: ColumnFacets = {};
    for (const field of fields) {
      if (!isTextFilterable(field.fieldType)) continue;
      const valExpr = sql<string>`(${records.data} ->> ${field.slug})`;
      const groups = await tx
        .select({ value: valExpr, count: sql<number>`count(*)::int` })
        .from(records)
        .where(and(baseWhere, sql`${valExpr} is not null`, sql`${valExpr} <> ''`))
        // Group on the output ordinal: the slug is a bound parameter, so a
        // re-stated expression would carry a different placeholder and Postgres
        // would not match it to the SELECT target.
        .groupBy(sql`1`);

      // "Intelligently filterable": ≥2 distinct values AND at least one
      // repeats (so always-unique columns like email/phone are excluded).
      const repeats = groups.some((g) => g.count >= 2);
      if (groups.length >= 2 && repeats) {
        facets[field.slug] = groups
          .map((g) => g.value)
          .sort((a, b) => a.localeCompare(b));
      }
    }

    return {
      fields,
      rows,
      total: countRow?.total ?? 0,
      layoutConfig,
      members,
      facets,
    };
  });
}
