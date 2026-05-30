import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@adserve/database";
import { resolveCrmEntitySlug } from "@adserve/crm";
import { getEntityTypeBySlug, listFieldDefinitions } from "@adserve/module-framework";
import { aiComplete, recordCreationPrompt } from "@adserve/ai-service";
import { apiRequirePermission } from "@/lib/permissions";
import {
  aiErrorResponse,
  malformedAiOutput,
  parseAiJson,
} from "@/lib/crm/ai-response";

type Params = { params: Promise<{ entityType: string }> };

/**
 * POST /api/crm/[entityType]/from-nl — Task 1.7a. Parse a free-form
 * description into structured draft field values for the UI to confirm.
 * Does NOT create the record (the normal create path does that, validated +
 * metered separately). Metered as crm/record_creation via aiComplete.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { entityType: segment } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const guard = await apiRequirePermission(`${slug}.create`);
  if (guard.error) return guard.error;
  const { tenant, user } = guard.ctx;

  let body: { prompt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const prompt = body.prompt;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return NextResponse.json(
      { error: "Field 'prompt' is required" },
      { status: 400 }
    );
  }

  const userPrompt = await withTenant(tenant.id, async (tx) => {
    const entity = await getEntityTypeBySlug(tx, { tenantId: tenant.id, slug });
    if (!entity) return null;
    const fields = await listFieldDefinitions(tx, {
      tenantId: tenant.id,
      entityTypeId: entity.id,
    });
    const fieldCatalog = fields.map((f) => ({
      slug: f.slug,
      fieldType: f.fieldType,
      description: f.description ?? undefined,
    }));
    return recordCreationPrompt.buildUserPrompt({
      entityType: slug,
      prompt,
      fieldCatalog,
    });
  });
  if (userPrompt === null) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const result = await aiComplete({
    tenantId: tenant.id,
    userId: user.id,
    module: "crm",
    capability: "record_creation",
    messages: [{ role: "user", content: userPrompt }],
  });
  if (!result.ok) return aiErrorResponse(result.error);

  const parsed = parseAiJson(result.content);
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
    return malformedAiOutput();
  }
  return NextResponse.json({ fields: parsed.value });
}
