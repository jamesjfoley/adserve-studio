import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { activities, withTenant } from "@adserve/database";
import {
  CRM_ENTITY_TYPES,
  crmCollectionSegment,
  resolveCrmEntitySlug,
} from "@adserve/crm";
import { requirePermission } from "@/lib/permissions";
import { loadEntityForm } from "@/lib/crm/load-entity-form";
import { loadRecordWithRelationships } from "@/lib/crm/relationships";
import { recordTitle } from "@/lib/crm/record-title";
import { computeRecordCapabilities } from "@/lib/crm/detail-capabilities";
import { CrmDetailClient } from "./_components/crm-detail-client";

type PageProps = {
  params: Promise<{ entityType: string; id: string }>;
};

/** Wire shape for an activity timeline entry. */
export interface SerializedActivity {
  id: string;
  activityType: string;
  subject: string | null;
  body: Record<string, unknown>;
  performedBy: string | null;
  createdAt: string;
}

export default async function CrmDetailPage({ params }: PageProps) {
  const { entityType: segment, id } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) notFound();

  // Redirects to /dashboard if the user lacks `<entity>.read`.
  const { tenant, user, permissions } = await requirePermission(`${slug}.read`);

  // Timeline visibility is its own permission — a user may read the record
  // without `activity.read` (mirrors the API boundary).
  const canViewActivities = permissions.has("activity.read");

  const data = await withTenant(tenant.id, async (tx) => {
    const bundle = await loadEntityForm(tx, { tenantId: tenant.id, slug });
    if (!bundle) return null;

    const loaded = await loadRecordWithRelationships(tx, {
      tenantId: tenant.id,
      entityTypeId: bundle.entity.id,
      recordId: id,
    });
    if (!loaded) return null;

    const activityRows = canViewActivities
      ? await tx
          .select()
          .from(activities)
          .where(
            and(
              eq(activities.tenantId, tenant.id),
              eq(activities.recordId, id)
            )
          )
          .orderBy(desc(activities.createdAt))
      : [];

    return { bundle, loaded, activityRows };
  });

  if (!data) notFound();

  const { bundle, loaded, activityRows } = data;
  const { entity, fields, layoutConfig } = bundle;
  const { record, relationships } = loaded;

  const title = recordTitle(entity, fields, record.data, record.id);
  const entityMeta = CRM_ENTITY_TYPES.find((e) => e.slug === slug);

  const { canEdit, canArchive, canConvert, canLogActivity } =
    computeRecordCapabilities({
      slug,
      permissions,
      userId: user.id,
      ownedBy: record.ownedBy,
    });

  const serializedActivities: SerializedActivity[] = activityRows.map((a) => ({
    id: a.id,
    activityType: a.activityType,
    subject: a.subject,
    body: (a.body as Record<string, unknown>) ?? {},
    performedBy: a.performedBy ?? null,
    createdAt: a.createdAt.toISOString(),
  }));

  return (
    <CrmDetailClient
      collectionSegment={crmCollectionSegment(slug) ?? segment}
      entityName={entityMeta?.name ?? slug}
      recordId={record.id}
      title={title}
      record={record}
      fields={fields}
      layoutConfig={layoutConfig}
      relationships={relationships}
      activities={serializedActivities}
      canEdit={canEdit}
      canArchive={canArchive}
      canConvert={canConvert}
      canLogActivity={canLogActivity}
      canViewActivities={canViewActivities}
      showAiSummary={slug === "account" && canViewActivities}
      locale="en-GB"
    />
  );
}
