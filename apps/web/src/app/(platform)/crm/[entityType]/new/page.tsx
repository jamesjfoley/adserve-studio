import { notFound } from "next/navigation";
import { resolveCrmEntitySlug, crmCollectionSegment, CRM_ENTITY_TYPES } from "@adserve/crm";
import { withTenant } from "@adserve/database";
import { requirePermission, getTenantContextOrNull } from "@/lib/permissions";
import {
  readCrmModuleConfig,
  isCrmEntityEnabled,
} from "@/lib/crm/module-config";
import { loadEntityForm } from "@/lib/crm/load-entity-form";
import { CrmCreateClient } from "./_components/crm-create-client";

type PageProps = { params: Promise<{ entityType: string }> };

/**
 * Full-page "create" form for a CRM entity (replaces the list modal). Uses the
 * entity's detail layout in create mode, so a new Account/Contact is entered on
 * the same panelled page it will be viewed on. Widget panels (Brands, Account
 * History) are skipped here — there's no record yet.
 */
export default async function CrmCreatePage({ params }: PageProps) {
  const { entityType: segment } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) notFound();

  // Module guard before permission (disabled module → 404, like the list).
  const ctx = await getTenantContextOrNull();
  if (ctx && !isCrmEntityEnabled(readCrmModuleConfig(ctx.tenant.settings), slug)) {
    notFound();
  }

  const { tenant } = await requirePermission(`${slug}.create`);

  const bundle = await withTenant(tenant.id, (tx) =>
    loadEntityForm(tx, { tenantId: tenant.id, slug })
  );
  if (!bundle) notFound();

  const entityMeta = CRM_ENTITY_TYPES.find((e) => e.slug === slug);

  return (
    <CrmCreateClient
      slug={slug}
      collectionSegment={crmCollectionSegment(slug) ?? segment}
      entityName={entityMeta?.name ?? slug}
      fields={bundle.fields}
      layoutConfig={bundle.layoutConfig}
      locale="en-GB"
    />
  );
}
