import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@adserve/database";
import { resolveCrmEntitySlug } from "@adserve/crm";
import { getEntityTypeBySlug, listFieldDefinitions } from "@adserve/module-framework";
import { aiComplete, smartSearchPrompt } from "@adserve/ai-service";
import { apiRequirePermission } from "@/lib/permissions";
import {
  aiErrorResponse,
  malformedAiOutput,
  parseAiJson,
} from "@/lib/crm/ai-response";

type Params = { params: Promise<{ entityType: string }> };

/**
 * POST /api/crm/[entityType]/smart-search — Task 1.7d. Translate a
 * natural-language query into a structured filter state the dynamic table
 * can consume. Returns the filters only — does NOT execute the search.
 * Metered as crm/smart_search via aiComplete.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { entityType: segment } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const guard = await apiRequirePermission(`${slug}.read`);
  if (guard.error) return guard.error;
  const { tenant, user } = guard.ctx;

  let body: { query?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const query = body.query;
  if (typeof query !== "string" || query.trim() === "") {
    return NextResponse.json(
      { error: "Field 'query' is required" },
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
    const filterableFields = fields
      .filter((f) => f.isFilterable)
      .map((f) => ({
        slug: f.slug,
        fieldType: f.fieldType,
        label:
          ((f.labels as { en?: string } | null)?.en ?? f.name) || f.slug,
      }));
    return smartSearchPrompt.buildUserPrompt({
      entityType: slug,
      query,
      filterableFields,
    });
  });
  if (userPrompt === null) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const result = await aiComplete({
    tenantId: tenant.id,
    userId: user.id,
    module: "crm",
    capability: "smart_search",
    messages: [{ role: "user", content: userPrompt }],
  });
  if (!result.ok) return aiErrorResponse(result.error);

  const parsed = parseAiJson(result.content);
  if (
    !parsed.ok ||
    typeof parsed.value !== "object" ||
    parsed.value === null ||
    !Array.isArray((parsed.value as { filters?: unknown }).filters)
  ) {
    return malformedAiOutput();
  }
  return NextResponse.json({
    filters: (parsed.value as { filters: unknown[] }).filters,
  });
}
