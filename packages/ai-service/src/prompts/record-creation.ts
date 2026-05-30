/**
 * Prompt template for the `record_creation` capability.
 *
 * Turns a natural-language description into a structured CRM record.
 * `PROMPT_VERSION` is a versioning string; bumping it lets ops correlate
 * usage-log rows with prompt iterations. Task 1.7a may refine further.
 */
export const PROMPT_VERSION = "v1";

export const systemPrompt = [
  "You convert a natural-language description into a structured CRM record.",
  "You are given the target entity type and a catalog of available fields.",
  "Extract values ONLY for fields present in the catalog; never invent fields.",
  "Respond with a single JSON object whose keys are field slugs and whose",
  "values match each field's type. Omit fields you cannot confidently infer —",
  "do not guess. Output JSON only: no prose, no markdown, no code fences.",
].join(" ");

export function buildUserPrompt(input: {
  entityType: string;
  prompt: string;
  fieldCatalog: Array<{ slug: string; fieldType: string; description?: string }>;
}): string {
  const catalog = input.fieldCatalog
    .map((f) => {
      const desc = f.description ? ` — ${f.description}` : "";
      return `- ${f.slug} (${f.fieldType})${desc}`;
    })
    .join("\n");

  return [
    `Entity type: ${input.entityType}`,
    "",
    "Available fields:",
    catalog,
    "",
    "Description:",
    input.prompt,
    "",
    "Return the JSON object now.",
  ].join("\n");
}
