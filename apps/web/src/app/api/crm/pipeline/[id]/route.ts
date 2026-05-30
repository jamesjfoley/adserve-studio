import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { entityTypes, records, withTenant } from "@adserve/database";
import type { PipelineStageSpec } from "@adserve/crm";
import { apiRequirePermission } from "@/lib/permissions";
import { serializeRecord } from "@/lib/crm/serialize";
import { writeAuditLog } from "@/lib/crm/audit";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/crm/pipeline/[id] — move an opportunity to a different stage.
 *
 * A pure `pipeline.update` gate (NOT the permission-OR-ownership rule of the
 * generic record PATCH — moving cards is governed solely by pipeline.update).
 * Validates the target stage against the tenant's configured pipelineStages
 * and sets BOTH `data.stage` and `data.probability` (auto-populated from the
 * stage's defaultProbability, per the pipeline.ts contract). RLS-safe: both
 * the existence SELECT and the UPDATE carry tenant_id + entity_type_id
 * predicates, so a forged id from another tenant returns 404, never a write.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await apiRequirePermission("pipeline.update");
  if (guard.error) return guard.error;
  const { tenant, user } = guard.ctx;
  const { id } = await params;

  let body: { stage?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const stage = body.stage;
  if (typeof stage !== "string" || stage === "") {
    return NextResponse.json(
      { error: "Field 'stage' is required" },
      { status: 400 }
    );
  }

  const outcome = await withTenant(tenant.id, async (tx) => {
    const [opp] = await tx
      .select({ id: entityTypes.id, settings: entityTypes.settings })
      .from(entityTypes)
      .where(
        and(
          eq(entityTypes.tenantId, tenant.id),
          eq(entityTypes.slug, "opportunity")
        )
      );
    if (!opp) return { kind: "not_found" as const };

    const stages =
      (opp.settings as { pipelineStages?: PipelineStageSpec[] } | null)
        ?.pipelineStages ?? [];
    const target = stages.find((s) => s.slug === stage);
    if (!target) {
      return { kind: "invalid" as const };
    }

    const [existing] = await tx
      .select()
      .from(records)
      .where(
        and(
          eq(records.id, id),
          eq(records.tenantId, tenant.id),
          eq(records.entityTypeId, opp.id),
          eq(records.isArchived, false)
        )
      );
    if (!existing) return { kind: "not_found" as const };

    const before = (existing.data as Record<string, unknown>) ?? {};
    const after = {
      ...before,
      stage: target.slug,
      probability: target.defaultProbability,
    };

    const [row] = await tx
      .update(records)
      .set({ data: after, updatedBy: user.id, updatedAt: new Date() })
      .where(
        and(eq(records.id, id), eq(records.tenantId, tenant.id))
      )
      .returning();

    await writeAuditLog(tx, {
      tenantId: tenant.id,
      userId: user.id,
      action: "update",
      resourceType: "opportunity",
      resourceId: id,
      changes: { before, after },
    });

    return { kind: "ok" as const, row };
  });

  if (outcome.kind === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (outcome.kind === "invalid") {
    return NextResponse.json(
      { error: "Unknown stage for this tenant" },
      { status: 422 }
    );
  }
  return NextResponse.json({ record: serializeRecord(outcome.row) });
}
