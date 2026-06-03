import { requirePermission } from "@/lib/permissions";
import { loadAdminLayoutsData } from "@/lib/admin/loaders";
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

  const data = await loadAdminLayoutsData({ tenantId: ctx.tenant.id, entitySlug });

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
                ? "border-[var(--accent)] text-[var(--accent)]"
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
