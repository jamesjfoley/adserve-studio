import type { AICapability, AIModel } from "./types";

/**
 * Capability → model mapping. Modules don't choose models; they declare
 * a capability and the service routes to the right tier.
 *
 * Defaults below use placeholder model IDs. Real model names come from
 * env vars at call time (see `resolveModelForCapability`) so model
 * swaps don't require code changes:
 *
 *   AI_MODEL_FIELD_SUGGESTION=claude-haiku-...
 *   AI_MODEL_RECORD_CREATION=claude-sonnet-...
 *   AI_MODEL_ACTIVITY_SUMMARY=claude-sonnet-...
 *   AI_MODEL_SMART_SEARCH=claude-sonnet-...
 *   AI_MODEL_COMPLEX_ANALYSIS=claude-opus-...
 */
export const DEFAULT_CAPABILITY_TO_MODEL: Record<AICapability, AIModel> = {
  field_suggestion: "claude-haiku-placeholder",
  record_creation: "claude-sonnet-placeholder",
  activity_summary: "claude-sonnet-placeholder",
  smart_search: "claude-sonnet-placeholder",
  complex_analysis: "claude-opus-placeholder",
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
