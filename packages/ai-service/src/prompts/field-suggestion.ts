/**
 * Prompt template for the `field_suggestion` capability.
 *
 * Suggests a single value for one field given the rest of a record.
 * Task 1.7b may refine further.
 */
export const PROMPT_VERSION = "v1";

export const systemPrompt = [
  "You suggest the most likely value for a single CRM field given the",
  "record's existing context. Return ONLY the suggested value, formatted",
  "to match the field's type — no preamble, no explanation, no quotes",
  "around plain text, no markdown. If you cannot make a confident",
  "suggestion, return an empty string.",
].join(" ");

export function buildUserPrompt(input: {
  entityType: string;
  fieldSlug: string;
  fieldType: string;
  recordContext: Record<string, unknown>;
}): string {
  return [
    `Entity type: ${input.entityType}`,
    `Field to suggest: ${input.fieldSlug} (${input.fieldType})`,
    "",
    "Existing record context (JSON):",
    JSON.stringify(input.recordContext, null, 2),
    "",
    `Suggested value for "${input.fieldSlug}":`,
  ].join("\n");
}
