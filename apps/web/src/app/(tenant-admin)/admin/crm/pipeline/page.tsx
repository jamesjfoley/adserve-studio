import { entityTypes, withTenant } from "@adserve/database";
import { and, eq } from "drizzle-orm";
import type { PipelineStageSpec } from "@adserve/crm";
import { requirePermission } from "@/lib/permissions";
import { PipelineStagesEditor } from "./_components/pipeline-stages-editor";

export const dynamic = "force-dynamic";

export default async function CrmPipelineConfigPage() {
  const ctx = await requirePermission("crm.admin");

  const stages = await withTenant(ctx.tenant.id, async (tx) => {
    const [opp] = await tx
      .select({ settings: entityTypes.settings })
      .from(entityTypes)
      .where(
        and(
          eq(entityTypes.tenantId, ctx.tenant.id),
          eq(entityTypes.slug, "opportunity")
        )
      );
    return (
      ((opp?.settings as { pipelineStages?: PipelineStageSpec[] } | null)
        ?.pipelineStages ?? [])
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)
    );
  });

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
