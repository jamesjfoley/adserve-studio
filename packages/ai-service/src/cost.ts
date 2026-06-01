import type { AIModel, TokenUsage } from "./types";

/**
 * Cost calculation. Real implementation — pure math, safe to use today.
 *
 * Pricing is stored in **microdollars per million tokens** (an integer)
 * so the math stays in integer space until display. Per-token unit
 * would lose precision for Haiku-tier prices.
 *
 * Values below are PLACEHOLDERS verified to be in the right ballpark
 * for Claude 3.5 / 4.x family models as of late 2025. Task 0.7 verifies
 * against the current Anthropic pricing page before any rotation lands
 * and updates these (or moves them to a config table if pricing churn
 * makes constants annoying).
 */
export interface ModelPricing {
  /** Microdollars per 1M input tokens. e.g. Sonnet at $3/M = 3_000_000. */
  inputPerMTokenMicros: number;
  /** Microdollars per 1M output tokens. */
  outputPerMTokenMicros: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Real model IDs (Task 0.7). Prices are Anthropic published list
  // prices as of 2026-05-30 — re-verify quarterly against the pricing
  // page. These keys MUST match the IDs `models.ts` resolves to, or
  // `calculateCostMicros` throws `UnmappedModelError` (fail safe) and the
  // call fails cleanly rather than billing at zero under the $50 cap.
  "claude-haiku-4-5-20251001": {
    inputPerMTokenMicros: 1_000_000, // $1 / 1M input
    outputPerMTokenMicros: 5_000_000, // $5 / 1M output
  },
  "claude-sonnet-4-6": {
    inputPerMTokenMicros: 3_000_000, // $3 / 1M input
    outputPerMTokenMicros: 15_000_000, // $15 / 1M output
  },
  "claude-opus-4-8": {
    inputPerMTokenMicros: 5_000_000, // $5 / 1M input
    outputPerMTokenMicros: 25_000_000, // $25 / 1M output
  },
};

/**
 * Thrown when a model id has no entry in `MODEL_PRICING`. This is the
 * fail-safe: an unmapped model MUST surface a clear error rather than
 * silently bill at zero. A zero-cost row for real token consumption would
 * never roll into the usage summary and so would slip under the $50 cap —
 * the exact failure this guards against. `aiComplete` catches this and
 * maps it to an `unmapped_model` AIError (clean failure, real token counts
 * preserved on the usage row), so it never escapes the service boundary.
 */
export class UnmappedModelError extends Error {
  readonly model: string;
  constructor(model: string) {
    super(
      `No pricing configured for model '${model}'; refusing to bill at zero.`
    );
    this.name = "UnmappedModelError";
    this.model = model;
  }
}

/**
 * Calculate the call cost in microdollars from token usage.
 *
 * Unknown model → throws `UnmappedModelError` (fail safe). The attempt is
 * still recorded by `aiComplete` with its real token counts and a clear
 * error message, so ops keep visibility via `ai_usage_log` — but the call
 * fails rather than billing zero and bypassing the cap.
 */
export function calculateCostMicros(
  model: AIModel,
  usage: TokenUsage
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) throw new UnmappedModelError(model);

  const inputCost =
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTokenMicros;
  const outputCost =
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTokenMicros;

  return Math.round(inputCost + outputCost);
}

/**
 * Default cost limit per tenant on module activation.
 *
 * The value is **$50 USD** expressed in microdollars (Anthropic bills in
 * USD, so the cap is naturally a USD figure). The product spec frames it
 * as "£50/month *equivalent*" — GBP is a display concern and there is no
 * live FX in Phase 1b, so we treat $50 as the fixed cap and defer any
 * GBP conversion to the presentation layer.
 *
 * IMPORTANT: this is 50_000_000 micro-DOLLARS = $50, NOT £50. Do not
 * reason about it as GBP without applying an FX rate.
 *
 * $50 × 1_000_000 = 50_000_000 micros.
 */
export const DEFAULT_MONTHLY_COST_LIMIT_MICROS = 50_000_000;
