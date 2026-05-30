import { entityTypes, withTenant } from "@adserve/database";
import { and, eq } from "drizzle-orm";
import { listFieldDefinitions } from "@adserve/module-framework";
import { requirePermission } from "@/lib/permissions";
import { FieldsManager } from "./_components/fields-manager";

export const dynamic = "force-dynamic";

const CRM_ENTITIES = [
  { slug: "account", name: "Accounts" },
  { slug: "contact", name: "Contacts" },
  { slug: "lead", name: "Leads" },
  { slug: "opportunity", name: "Opportunities" },
];

type SearchParams = Promise<{ entity?: string }>;

export default async function CrmFieldsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctx = await requirePermission("crm.admin");
  const sp = await searchParams;
  const entitySlug = CRM_ENTITIES.some((e) => e.slug === sp.entity)
    ? sp.entity!
    : "account";

  const fields = await withTenant(ctx.tenant.id, async (tx) => {
    const [entity] = await tx
      .select({ id: entityTypes.id })
      .from(entityTypes)
      .where(
        and(
          eq(entityTypes.tenantId, ctx.tenant.id),
          eq(entityTypes.slug, entitySlug)
        )
      );
    if (!entity) return [];
    return listFieldDefinitions(tx, {
      tenantId: ctx.tenant.id,
      entityTypeId: entity.id,
    });
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">CRM fields</h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Add, edit, reorder, and remove fields per entity type.
      </p>

      <nav className="mt-6 flex gap-2 border-b border-[var(--border)]">
        {CRM_ENTITIES.map((e) => (
          <a
            key={e.slug}
            href={`/admin/crm/fields?entity=${e.slug}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              e.slug === entitySlug
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            {e.name}
          </a>
        ))}
      </nav>

      <FieldsManager
        entityType={entitySlug}
        fields={fields.map((f) => ({
          id: f.id,
          name: f.name,
          slug: f.slug,
          fieldType: f.fieldType,
          isRequired: f.isRequired,
          isFilterable: f.isFilterable,
          isSystem: f.isSystem,
          description: f.description ?? "",
        }))}
      />
    </div>
  );
}
