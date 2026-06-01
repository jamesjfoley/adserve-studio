import { notFound } from "next/navigation";
import {
  CRM_ENTITY_TYPES,
  DEFAULT_LIST_COLUMNS,
  crmCollectionSegment,
  resolveCrmEntitySlug,
} from "@adserve/crm";
import { requirePermission } from "@/lib/permissions";
import { parseListParams } from "@/lib/crm/query";
import { serializeRecord } from "@/lib/crm/serialize";
import { loadCrmListData } from "@/lib/crm/load-list-data";
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
  const { tenant, user } = await requirePermission(`${slug}.read`);

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

  const data = await loadCrmListData({
    tenantId: tenant.id,
    slug,
    parsed,
    userId: user.id,
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
      members={data.members}
      owner={parsed.owner}
      locale="en-GB"
    />
  );
}
