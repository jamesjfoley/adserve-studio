/**
 * Prompt template for the `smart_search` capability — STUB.
 * Task 0.7 / 1.7d fills this in.
 */
export const PROMPT_VERSION = "v0.1-stub";

export const systemPrompt =
  "TODO(task-0.7): smart_search system prompt — output strict JSON filter state, no prose";

export function buildUserPrompt(_input: {
  entityType: string;
  query: string;
  /** Available fields the user can filter on. */
  filterableFields: Array<{
    slug: string;
    fieldType: string;
    label: string;
  }>;
}): string {
  throw new Error("smart-search buildUserPrompt not implemented (Task 0.7)");
}
