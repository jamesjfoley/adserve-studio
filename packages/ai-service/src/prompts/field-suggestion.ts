/**
 * Prompt template for the `field_suggestion` capability — STUB.
 * Task 0.7 / 1.7b fills this in.
 */
export const PROMPT_VERSION = "v0.1-stub";

export const systemPrompt =
  "TODO(task-0.7): field_suggestion system prompt — short, single value, no preamble";

export function buildUserPrompt(_input: {
  entityType: string;
  fieldSlug: string;
  fieldType: string;
  recordContext: Record<string, unknown>;
}): string {
  throw new Error("field-suggestion buildUserPrompt not implemented (Task 0.7)");
}
