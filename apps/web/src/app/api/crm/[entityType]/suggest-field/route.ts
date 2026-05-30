import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@adserve/database";
import { resolveCrmEntitySlug } from "@adserve/crm";
import { getEntityTypeBySlug, listFieldDefinitions } from "@adserve/module-framework";
import { aiComplete, fieldSuggestionPrompt } from "@adserve/ai-service";
import { aiErrorResponse, resolveTenantCtx } from "@/lib/crm/ai-response";

type Params = { params: Promise<{ entityType: string }> };

/**
 * POST /api/crm/[entityType]/suggest-field — Task 1.7b. Suggest a single
 * value for one field given the record's existing context. Gated on
 * create OR update (the button appears on both create and edit forms).
 * Metered as crm/field_suggestion via aiComplete.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { entityType: segment } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const guard = await resolveTenantCtx();
  if (guard.error) return guard.error;
  const { ctx } = guard;
  const { tenant, user, permissions } = ctx;
  if (!permissions.has(`${slug}.create`) && !permissions.has(`${slug}.update`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { recordContext?: unknown; fieldSlug?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const fieldSlug = body.fieldSlug;
  if (typeof fieldSlug !== "string" || fieldSlug === "") {
    return NextResponse.json(
      { error: "Field 'fieldSlug' is required" },
      { status: 400 }
    );
  }
  const recordContext =
    body.recordContext && typeof body.recordContext === "object"
      ? (body.recordContext as Record<string, unknown>)
      : {};

  const built = await withTenant(tenant.id, async (tx) => {
    const entity = await getEntityTypeBySlug(tx, { tenantId: tenant.id, slug });
    if (!entity) return { kind: "no_entity" as const };
    const fields = await listFieldDefinitions(tx, {
      tenantId: tenant.id,
      entityTypeId: entity.id,
    });
    const field = fields.find((f) => f.slug === fieldSlug);
    if (!field) return { kind: "no_field" as const };
    return {
      kind: "ok" as const,
      prompt: fieldSuggestionPrompt.buildUserPrompt({
        entityType: slug,
        fieldSlug,
        fieldType: field.fieldType,
        recordContext,
      }),
    };
  });

  if (built.kind === "no_entity") {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }
  if (built.kind === "no_field") {
    return NextResponse.json(
      { error: `Unknown field '${fieldSlug}'` },
      { status: 400 }
    );
  }

  const result = await aiComplete({
    tenantId: tenant.id,
    userId: user.id,
    module: "crm",
    capability: "field_suggestion",
    messages: [{ role: "user", content: built.prompt }],
  });
  if (!result.ok) return aiErrorResponse(result.error);

  return NextResponse.json({ suggestion: result.content });
}
