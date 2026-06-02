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
 * fail-safe: an unmapped model MUST surface rather than silently bill at zero
 * (a zero-cost row for real token consumption would never roll into the usage
 * summary and so would slip under the $50 cap). `aiComplete` enforces this on
 * two tiers, so this error never escapes the service boundary:
 *   - PRE-call, it gates on `isModelPriced(resolvedModel)` and refuses with an
 *     `unmapped_model` AIError before spending any tokens (ZERO_USAGE row).
 *   - POST-call, `calculateCostMicros` throws this for the model the API
 *     actually returned; `aiComplete` catches it and meters CONSERVATIVELY
 *     (see `conservativeCostMicros`) rather than dropping the already-incurred
 *     cost, then alerts ops.
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
 * Unknown model → throws `UnmappedModelError` (fail safe), never returns 0.
 * Callers must handle the throw: `aiComplete` gates priceability pre-call and
 * falls back to `conservativeCostMicros` if the API returns an unpriced model
 * post-call (see `UnmappedModelError`).
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
 * Whether `model` has a pricing entry. Used by `aiComplete` as the PRE-call
 * gate: a request routed to an unpriceable model is refused before any tokens
 * are spent, rather than discovered only after the API call.
 */
export function isModelPriced(model: AIModel): boolean {
  return Object.prototype.hasOwnProperty.call(MODEL_PRICING, model);
}

/**
 * Conservative fallback cost: price `usage` at the HIGHEST known input and
 * output rates across `MODEL_PRICING`. Used only as the post-call backstop —
 * when the API returns a model id we have no price for, the tokens are already
 * spent, so dropping the cost (billing zero) would let real usage slip under
 * the cap. Billing the max rate guarantees we never UNDER-charge; slight
 * over-charging on a genuinely unknown model is the safe direction. Pair it
 * with a log/alert so the price gets added and the estimate stops being used.
 */
export function conservativeCostMicros(usage: TokenUsage): number {
  const rates = Object.values(MODEL_PRICING);
  const maxInputMicros = Math.max(...rates.map((p) => p.inputPerMTokenMicros));
  const maxOutputMicros = Math.max(
    ...rates.map((p) => p.outputPerMTokenMicros)
  );

  const inputCost = (usage.inputTokens / 1_000_000) * maxInputMicros;
  const outputCost = (usage.outputTokens / 1_000_000) * maxOutputMicros;

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
