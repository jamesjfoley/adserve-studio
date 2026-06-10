import { requirePermission } from "@/lib/permissions";
import { Panel } from "@/components/ui/panel";
import { BrandingForm } from "./_components/branding-form";

export const dynamic = "force-dynamic";

/**
 * Branding & shell settings. Gated on crm.admin (matching the /api/admin/shell
 * write authz and the other CRM admin pages). Lets an admin upload/clear a
 * company logo and choose the Title Bar display mode. Both persist into
 * tenants.settings (branding.logoUrl / shell.titleBarMode) via the shell route.
 */
export default async function BrandingPage() {
  const ctx = await requirePermission("crm.admin");
  const settings = (ctx.tenant.settings ?? {}) as Record<string, unknown>;
  const logoUrl =
    (settings.branding as { logoUrl?: string } | undefined)?.logoUrl ?? null;
  const titleBarMode =
    (settings.shell as { titleBarMode?: string } | undefined)?.titleBarMode ===
    "auto-hide"
      ? "auto-hide"
      : "always";

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Branding &amp; shell</h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Upload your company logo and choose how the title bar behaves across the
        platform for this organisation.
      </p>

      <div className="mt-6 grid gap-6">
        <Panel title="Logo & title bar">
          <BrandingForm
            initialLogoUrl={logoUrl}
            initialTitleBarMode={titleBarMode}
          />
        </Panel>
      </div>
    </div>
  );
}
