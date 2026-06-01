import type { AICapability, AIModel } from "./types";

/**
 * Capability → model mapping. Modules don't choose models; they declare
 * a capability and the service routes to the right tier.
 *
 * Defaults below use real Claude model IDs (Task 0.7) and MUST match a
 * key in `cost.ts` `MODEL_PRICING`. They can still be overridden per
 * environment via env vars at call time (see `resolveModelForCapability`)
 * so model swaps don't require code changes:
 *
 *   AI_MODEL_FIELD_SUGGESTION=claude-haiku-...
 *   AI_MODEL_RECORD_CREATION=claude-sonnet-...
 *   AI_MODEL_ACTIVITY_SUMMARY=claude-sonnet-...
 *   AI_MODEL_SMART_SEARCH=claude-sonnet-...
 *   AI_MODEL_COMPLEX_ANALYSIS=claude-opus-...
 *
 * NB: a model resolved from an env var must also exist in `MODEL_PRICING`,
 * or the call fails safe — `calculateCostMicros` throws `UnmappedModelError`
 * and `aiComplete` returns a clean `unmapped_model` error rather than billing
 * the call at zero (see `calculateCostMicros`).
 */
export const DEFAULT_CAPABILITY_TO_MODEL: Record<AICapability, AIModel> = {
  field_suggestion: "claude-haiku-4-5-20251001",
  record_creation: "claude-sonnet-4-6",
  activity_summary: "claude-sonnet-4-6",
  smart_search: "claude-sonnet-4-6",
  complex_analysis: "claude-opus-4-8",
};

const ENV_VAR_BY_CAPABILITY: Record<AICapability, string> = {
  field_suggestion: "AI_MODEL_FIELD_SUGGESTION",
  record_creation: "AI_MODEL_RECORD_CREATION",
  activity_summary: "AI_MODEL_ACTIVITY_SUMMARY",
  smart_search: "AI_MODEL_SMART_SEARCH",
  complex_analysis: "AI_MODEL_COMPLEX_ANALYSIS",
};

/**
 * Resolve the model ID for a capability. Env var wins; default is
 * fallback. Pure function — safe to call from anywhere.
 */
export function resolveModelForCapability(capability: AICapability): AIModel {
  const envKey = ENV_VAR_BY_CAPABILITY[capability];
  return process.env[envKey] ?? DEFAULT_CAPABILITY_TO_MODEL[capability];
}
