/**
 * Prompt template for the `record_creation` capability — STUB.
 *
 * Task 0.7 / 1.7a fills in the system prompt and user prompt builder.
 * `PROMPT_VERSION` is a versioning string; bumping it lets ops correlate
 * usage-log rows with prompt iterations.
 */
export const PROMPT_VERSION = "v0.1-stub";

export const systemPrompt = "TODO(task-0.7): record_creation system prompt";

export function buildUserPrompt(_input: {
  entityType: string;
  prompt: string;
  fieldCatalog: Array<{ slug: string; fieldType: string; description?: string }>;
}): string {
  throw new Error("record-creation buildUserPrompt not implemented (Task 0.7)");
}
