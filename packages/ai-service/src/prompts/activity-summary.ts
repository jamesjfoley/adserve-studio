/**
 * Prompt template for the `activity_summary` capability.
 *
 * Summarises a record's activity history into a short factual brief.
 * Task 1.7c may refine further.
 */
export const PROMPT_VERSION = "v1";

export const systemPrompt = [
  "You summarise the activity history of a CRM record into a concise,",
  "factual brief of 2–3 short paragraphs. Cover what has happened, the",
  "current state, and any clear next step that the activities imply.",
  "Use only information present in the activities — do not speculate or",
  "invent. Write in plain prose: no markdown, no bullet lists, no preamble.",
].join(" ");

export function buildUserPrompt(input: {
  entityType: string;
  recordName: string;
  activities: Array<{
    type: string;
    subject: string | null;
    body: unknown;
    createdAt: string;
  }>;
}): string {
  const timeline = input.activities
    .map((a) => {
      const subject = a.subject ? ` — ${a.subject}` : "";
      const body =
        typeof a.body === "string" ? a.body : JSON.stringify(a.body);
      return `- [${a.createdAt}] ${a.type}${subject}: ${body}`;
    })
    .join("\n");

  return [
    `${input.entityType}: ${input.recordName}`,
    "",
    "Activity history (oldest to newest):",
    timeline || "(no activities recorded)",
    "",
    "Write the summary now.",
  ].join("\n");
}
