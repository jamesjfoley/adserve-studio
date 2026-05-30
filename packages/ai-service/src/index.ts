// ============================================================
// Types
// ============================================================
export type {
  AICapability,
  AIModel,
  TokenUsage,
  AIMessage,
  AICompletionRequest,
  AICompletionResponse,
  AIError,
  AIErrorCode,
  UsageRecord,
  UsageSummary,
  UsageLimit,
  UsageStatus,
} from "./types";

// ============================================================
// Cost
// ============================================================
export {
  MODEL_PRICING,
  calculateCostMicros,
  DEFAULT_MONTHLY_COST_LIMIT_MICROS,
  type ModelPricing,
} from "./cost";

// ============================================================
// Models
// ============================================================
export {
  DEFAULT_CAPABILITY_TO_MODEL,
  resolveModelForCapability,
} from "./models";

// ============================================================
// Client (Task 0.7)
// ============================================================
export { aiComplete } from "./client";
export type {
  AIServiceDeps,
  CheckLimitsFn,
  RecordUsageFn,
  RecordUsageInput,
} from "./client";

// ============================================================
// Metering (stub — Task 0.8)
// ============================================================
export {
  checkLimits,
  recordUsage,
  getCurrentPeriodSummary,
  getUsageLimits,
  setUsageLimits,
} from "./metering";

// ============================================================
// Permissions (constants seeded by Task 0.8)
// ============================================================
export {
  AI_PLATFORM_PERMISSIONS,
  type AIPlatformPermission,
} from "./permissions";

// ============================================================
// Prompts — versioned templates per capability
// ============================================================
export * as recordCreationPrompt from "./prompts/record-creation";
export * as fieldSuggestionPrompt from "./prompts/field-suggestion";
export * as activitySummaryPrompt from "./prompts/activity-summary";
export * as smartSearchPrompt from "./prompts/smart-search";
