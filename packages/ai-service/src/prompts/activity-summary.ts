/**
 * Prompt template for the `activity_summary` capability — STUB.
 * Task 0.7 / 1.7c fills this in.
 */
export const PROMPT_VERSION = "v0.1-stub";

export const systemPrompt =
  "TODO(task-0.7): activity_summary system prompt — 2-3 paragraph summary, factual tone";

export function buildUserPrompt(_input: {
  entityType: string;
  recordName: string;
  activities: Array<{
    type: string;
    subject: string | null;
    body: unknown;
    createdAt: string;
  }>;
}): string {
  throw new Error("activity-summary buildUserPrompt not implemented (Task 0.7)");
}
