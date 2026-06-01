import { requirePermission } from "@/lib/permissions";
import { loadAdminPipelineConfigData } from "@/lib/admin/loaders";
import { PipelineStagesEditor } from "./_components/pipeline-stages-editor";

export const dynamic = "force-dynamic";

export default async function CrmPipelineConfigPage() {
  const ctx = await requirePermission("crm.admin");

  const stages = await loadAdminPipelineConfigData(ctx.tenant.id);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Pipeline stages</h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Manage the opportunity pipeline. Slugs are fixed once created (renaming
        changes only the label); a stage that still has opportunities can&apos;t
        be removed.
      </p>
      <PipelineStagesEditor
        initialStages={stages.map((s) => ({
          slug: s.slug,
          name: s.name,
          defaultProbability: s.defaultProbability,
          isClosed: s.isClosed,
          isWon: s.isWon,
          existing: true,
        }))}
      />
    </div>
  );
}
