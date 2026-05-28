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
  // Placeholder keys — actual model IDs are env-configured at runtime.
  // Task 0.7 updates these once concrete model names + prices are
  // verified.
  "claude-haiku-placeholder": {
    inputPerMTokenMicros: 800_000, // $0.80 / 1M input
    outputPerMTokenMicros: 4_000_000, // $4.00 / 1M output
  },
  "claude-sonnet-placeholder": {
    inputPerMTokenMicros: 3_000_000, // $3 / 1M input
    outputPerMTokenMicros: 15_000_000, // $15 / 1M output
  },
  "claude-opus-placeholder": {
    inputPerMTokenMicros: 15_000_000, // $15 / 1M input
    outputPerMTokenMicros: 75_000_000, // $75 / 1M output
  },
};

/**
 * Calculate the call cost in microdollars from token usage.
 *
 * Unknown model → returns 0. The call still gets logged with cost 0;
 * ops can investigate via the `model` field on `ai_usage_log` rows.
 * Throwing here would lose visibility into the call entirely.
 */
export function calculateCostMicros(
  model: AIModel,
  usage: TokenUsage
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;

  const inputCost =
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTokenMicros;
  const outputCost =
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTokenMicros;

  return Math.round(inputCost + outputCost);
}

/**
 * Default cost limit per tenant on module activation: £50/month.
 * Stored in microdollars (no live FX — treat the number as fixed for
 * Phase 1; the UI shows it as £50 because that's our display
 * convention).
 *
 * £50 × 1_000_000 = 50_000_000 micros.
 */
export const DEFAULT_MONTHLY_COST_LIMIT_MICROS = 50_000_000;
