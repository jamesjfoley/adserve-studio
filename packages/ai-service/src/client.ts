import type { AICompletionRequest, AICompletionResponse } from "./types";

/**
 * AI service entry point — STUB.
 *
 * Implementation lands in Task 0.7. All AI calls across all modules
 * flow through this function. It:
 *   1. Resolves the model from `request.capability` via `./models.ts`
 *   2. Checks limits via `./metering.checkLimits`
 *   3. Calls the Anthropic API with the right prompt template
 *   4. Records the call via `./metering.recordUsage`
 *   5. Returns a structured `AICompletionResponse` (never throws past
 *      this boundary — errors come back as `{ ok: false, error }`)
 */
export async function aiComplete(
  _request: AICompletionRequest
): Promise<AICompletionResponse> {
  throw new Error("aiComplete not implemented (Task 0.7)");
}
