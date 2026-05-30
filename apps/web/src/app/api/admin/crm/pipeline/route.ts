import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { entityTypes, records, withTenant } from "@adserve/database";
import type { PipelineStageSpec } from "@adserve/crm";
import { apiRequirePermission } from "@/lib/permissions";

const SLUG_RE = /^[a-z][a-z0-9_]*$/;

interface IncomingStage {
  slug: string;
  name: string;
  defaultProbability: number;
  isClosed: boolean;
  isWon: boolean;
}

function validateStages(input: unknown):
  | { ok: true; stages: IncomingStage[] }
  | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "At least one pipeline stage is required" };
  }
  const seen = new Set<string>();
  const stages: IncomingStage[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "Each stage must be an object" };
    }
    const s = raw as Record<string, unknown>;
    const slug = typeof s.slug === "string" ? s.slug : "";
    const name = typeof s.name === "string" ? s.name.trim() : "";
    const prob = s.defaultProbability;
    if (!SLUG_RE.test(slug)) {
      return { ok: false, error: `Invalid stage slug: "${slug}"` };
    }
    if (seen.has(slug)) {
      return { ok: false, error: `Duplicate stage slug: "${slug}"` };
    }
    seen.add(slug);
    if (!name) return { ok: false, error: `Stage "${slug}" needs a name` };
    if (
      typeof prob !== "number" ||
      !Number.isFinite(prob) ||
      prob < 0 ||
      prob > 100
    ) {
      return {
        ok: false,
        error: `Stage "${slug}" probability must be 0–100`,
      };
    }
    stages.push({
      slug,
      name,
      defaultProbability: prob,
      isClosed: s.isClosed === true,
      isWon: s.isWon === true,
    });
  }
  // Refinement 4b: lead-convert uses the first open stage as the default;
  // keep at least one non-closed stage.
  if (!stages.some((s) => !s.isClosed)) {
    return { ok: false, error: "At least one open (non-closed) stage is required" };
  }
  return { ok: true, stages };
}

/**
 * PATCH /api/admin/crm/pipeline — replace the opportunity entity's pipeline
 * stages (entity_types.settings.pipelineStages). crm.admin only.
 *
 * Safety: deleting a stage that opportunities still reference (by data.stage
 * slug) is blocked with 409 — otherwise those records become invisible in the
 * kanban/dashboard and stuck in an unselectable stage. Renaming keeps the slug
 * immutable (the UI only edits the display name); a changed slug reads as a
 * delete + add and is caught by the same orphan check. displayOrder is
 * recomputed from array order.
 */
export async function PATCH(req: NextRequest) {
  const guard = await apiRequirePermission("crm.admin");
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  let body: { stages?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validated = validateStages(body.stages);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const incoming = validated.stages;

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
    if (!opp) return { kind: "no_entity" as const };

    const existing =
      (opp.settings as { pipelineStages?: PipelineStageSpec[] } | null)
        ?.pipelineStages ?? [];
    const incomingSlugs = new Set(incoming.map((s) => s.slug));
    const removedSlugs = existing
      .map((s) => s.slug)
      .filter((slug) => !incomingSlugs.has(slug));

    // Block removing a stage that opportunities still sit in.
    if (removedSlugs.length > 0) {
      const counts = await tx
        .select({
          stage: sql<string>`${records.data} ->> 'stage'`,
          n: sql<number>`count(*)::int`,
        })
        .from(records)
        .where(
          and(
            eq(records.tenantId, tenant.id),
            eq(records.entityTypeId, opp.id),
            eq(records.isArchived, false),
            inArray(sql`${records.data} ->> 'stage'`, removedSlugs)
          )
        )
        .groupBy(sql`${records.data} ->> 'stage'`);
      const blocking = counts.filter((c) => c.n > 0);
      if (blocking.length > 0) {
        return { kind: "in_use" as const, blocking };
      }
    }

    const pipelineStages: PipelineStageSpec[] = incoming.map((s, i) => ({
      slug: s.slug,
      name: s.name,
      displayOrder: (i + 1) * 10,
      defaultProbability: s.defaultProbability,
      isClosed: s.isClosed,
      isWon: s.isWon,
    }));

    const mergedSettings = {
      ...((opp.settings as Record<string, unknown> | null) ?? {}),
      pipelineStages,
    };

    await tx
      .update(entityTypes)
      .set({ settings: mergedSettings, updatedAt: new Date() })
      .where(
        and(eq(entityTypes.id, opp.id), eq(entityTypes.tenantId, tenant.id))
      );

    return { kind: "ok" as const, pipelineStages };
  });

  if (outcome.kind === "no_entity") {
    return NextResponse.json(
      { error: "Opportunity entity not found" },
      { status: 404 }
    );
  }
  if (outcome.kind === "in_use") {
    return NextResponse.json(
      {
        error:
          "Cannot remove a stage that opportunities are still in. Move them first.",
        inUse: outcome.blocking,
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ stages: outcome.pipelineStages });
}
