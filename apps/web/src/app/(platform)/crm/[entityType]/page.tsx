import { notFound } from "next/navigation";
import { asc, desc, sql } from "drizzle-orm";
import { records, withTenant } from "@adserve/database";
import {
  CRM_ENTITY_TYPES,
  DEFAULT_LIST_COLUMNS,
  crmCollectionSegment,
  resolveCrmEntitySlug,
} from "@adserve/crm";
import {
  generateDefaultLayoutConfig,
  getDefaultLayout,
  getEntityTypeBySlug,
  listFieldDefinitions,
  type LayoutConfig,
} from "@adserve/module-framework";
import { requirePermission } from "@/lib/permissions";
import { buildOrderBy, buildWhere, parseListParams } from "@/lib/crm/query";
import { serializeRecord } from "@/lib/crm/serialize";
import { CrmListClient } from "./_components/crm-list-client";

type PageProps = {
  params: Promise<{ entityType: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CrmListPage({ params, searchParams }: PageProps) {
  const { entityType: segment } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) notFound();

  // Redirects to /dashboard if the user lacks `<entity>.read`.
  const { tenant } = await requirePermission(`${slug}.read`);

  // Next gives searchParams as an object; reuse the exact 1.2 parser.
  const spObj = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(spObj)) {
    if (typeof v === "string") sp.set(k, v);
  }
  let parsed;
  try {
    parsed = parseListParams(sp);
  } catch {
    parsed = parseListParams(new URLSearchParams()); // bad params → defaults
  }

  const data = await withTenant(tenant.id, async (tx) => {
    const entity = await getEntityTypeBySlug(tx, { tenantId: tenant.id, slug });
    if (!entity) return null;

    const fields = await listFieldDefinitions(tx, {
      tenantId: tenant.id,
      entityTypeId: entity.id,
    });

    let where;
    let orderBy;
    try {
      where = buildWhere(
        tenant.id,
        entity.id,
        fields,
        parsed.filters,
        parsed.includeArchived
      );
      orderBy = buildOrderBy(fields, parsed.sort);
    } catch {
      // A filter/sort that doesn't apply to this entity → safe default view.
      where = buildWhere(tenant.id, entity.id, fields, [], parsed.includeArchived);
      orderBy = null;
    }

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

    // Layout for the "New" form — the activated default detail layout,
    // falling back to a generated one if somehow absent.
    const layoutRow = await getDefaultLayout(tx, {
      tenantId: tenant.id,
      entityTypeId: entity.id,
      layoutType: "detail",
    });
    const layoutConfig =
      (layoutRow?.config as LayoutConfig | undefined) ??
      (await generateDefaultLayoutConfig(tx, {
        tenantId: tenant.id,
        entityTypeId: entity.id,
      }));

    return { fields, rows, total: countRow?.total ?? 0, layoutConfig };
  });

  if (!data) notFound();

  const entityMeta = CRM_ENTITY_TYPES.find((e) => e.slug === slug);
  // Intersect defaults with this tenant's real fields (custom-field drift).
  const visibleColumns = (DEFAULT_LIST_COLUMNS[slug] ?? []).filter((s) =>
    data.fields.some((f) => f.slug === s)
  );

  return (
    <CrmListClient
      collectionSegment={crmCollectionSegment(slug) ?? segment}
      entityName={entityMeta?.name ?? slug}
      fields={data.fields}
      records={data.rows.map(serializeRecord)}
      defaultVisibleColumns={visibleColumns}
      sort={parsed.sort}
      filterState={{
        filters: parsed.filters,
        includeArchived: parsed.includeArchived,
      }}
      pagination={{
        offset: parsed.offset,
        limit: parsed.limit,
        total: data.total,
      }}
      createLayoutConfig={data.layoutConfig}
      locale="en-GB"
    />
  );
}
