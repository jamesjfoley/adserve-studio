/**
 * Prompt template for the `smart_search` capability.
 *
 * Turns a natural-language query into a structured filter state.
 * Task 1.7d may refine further.
 */
export const PROMPT_VERSION = "v1";

export const systemPrompt = [
  "You translate a natural-language search query into a structured filter",
  "over a CRM entity. You are given the fields that can be filtered on.",
  'Respond with a single JSON object of the form {"filters":[{"field":',
  '"<slug>","op":"<operator>","value":<value>}]} using ONLY the provided',
  "fields. Use operators eq, neq, contains, gt, gte, lt, lte, in. If the",
  "query maps to no usable filter, return {\"filters\":[]}. Output strict",
  "JSON only: no prose, no markdown, no code fences.",
].join(" ");

export function buildUserPrompt(input: {
  entityType: string;
  query: string;
  /** Available fields the user can filter on. */
  filterableFields: Array<{
    slug: string;
    fieldType: string;
    label: string;
  }>;
}): string {
  const fields = input.filterableFields
    .map((f) => `- ${f.slug} (${f.fieldType}) — ${f.label}`)
    .join("\n");

  return [
    `Entity type: ${input.entityType}`,
    "",
    "Filterable fields:",
    fields,
    "",
    "Query:",
    input.query,
    "",
    "Return the filter JSON now.",
  ].join("\n");
}
