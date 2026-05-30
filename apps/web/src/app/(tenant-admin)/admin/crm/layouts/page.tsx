import { entityTypes, withTenant } from "@adserve/database";
import { and, eq } from "drizzle-orm";
import {
  createLayout,
  generateDefaultLayoutConfig,
  getDefaultLayout,
  listFieldDefinitions,
  type LayoutConfig,
} from "@adserve/module-framework";
import { requirePermission } from "@/lib/permissions";
import { LayoutEditor } from "./_components/layout-editor";

export const dynamic = "force-dynamic";

const CRM_ENTITIES = [
  { slug: "account", name: "Accounts" },
  { slug: "contact", name: "Contacts" },
  { slug: "lead", name: "Leads" },
  { slug: "opportunity", name: "Opportunities" },
];

type SearchParams = Promise<{ entity?: string }>;

export default async function CrmLayoutsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctx = await requirePermission("crm.admin");
  const sp = await searchParams;
  const entitySlug = CRM_ENTITIES.some((e) => e.slug === sp.entity)
    ? sp.entity!
    : "account";

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [entity] = await tx
      .select({ id: entityTypes.id })
      .from(entityTypes)
      .where(
        and(
          eq(entityTypes.tenantId, ctx.tenant.id),
          eq(entityTypes.slug, entitySlug)
        )
      );
    if (!entity) return null;

    const fields = await listFieldDefinitions(tx, {
      tenantId: ctx.tenant.id,
      entityTypeId: entity.id,
    });

    // Resolve the default detail layout; bootstrap one if missing (safety
    // net — provisioning normally creates it). null → create, else → update.
    let layout = await getDefaultLayout(tx, {
      tenantId: ctx.tenant.id,
      entityTypeId: entity.id,
      layoutType: "detail",
    });
    if (!layout) {
      const config = await generateDefaultLayoutConfig(tx, {
        tenantId: ctx.tenant.id,
        entityTypeId: entity.id,
      });
      layout = await createLayout(tx, {
        tenantId: ctx.tenant.id,
        entityTypeId: entity.id,
        layoutType: "detail",
        name: "Detail",
        isDefault: true,
        config,
      });
    }

    return {
      layoutId: layout.id,
      config: layout.config as LayoutConfig,
      fields: fields.map((f) => ({ id: f.id, name: f.name })),
    };
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">CRM layouts</h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Arrange fields into sections for each entity&apos;s detail form.
      </p>

      <nav className="mt-6 flex gap-2 border-b border-[var(--border)]">
        {CRM_ENTITIES.map((e) => (
          <a
            key={e.slug}
            href={`/admin/crm/layouts?entity=${e.slug}`}
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

      {data ? (
        <LayoutEditor
          layoutId={data.layoutId}
          initialConfig={data.config}
          fields={data.fields}
        />
      ) : (
        <p className="mt-6 text-sm text-[var(--muted-foreground)]">
          Entity type not found.
        </p>
      )}
    </div>
  );
}
