/**
 * Public types for `@adserve/ai-service`. The shapes here are stable;
 * the implementations behind them (client.ts, metering.ts) are stubs
 * filled in by Task 0.7 / 0.8.
 */

/**
 * Capability identifier used both for prompt routing and metering.
 * Adding a new capability requires:
 *   1. Add a literal here
 *   2. Add a prompt template under `./prompts/`
 *   3. Add a default model mapping in `./models.ts`
 *   4. Module code calls `aiComplete({ capability: "...", ... })`
 */
export type AICapability =
  | "record_creation"
  | "field_suggestion"
  | "activity_summary"
  | "smart_search"
  | "complex_analysis"; // reserved for future Opus-tier work

/**
 * Model identifier. Kept as a string union of `string` to allow env-
 * configured overrides without recompiling. Validated at call time
 * via `MODEL_PRICING` lookup.
 */
export type AIModel = string;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AICompletionRequest {
  tenantId: string;
  userId: string;
  /** Originating module slug — `crm`, `campaigns`, etc. */
  module: string;
  capability: AICapability;
  messages: AIMessage[];
  /** Override the capability's default system prompt. Optional. */
  systemPrompt?: string;
  /**
   * Module-specific context for the metering log. Goes into
   * `ai_usage_log.request_metadata` JSONB.
   */
  metadata?: Record<string, unknown>;
  /** Hard timeout for the API call. Defaults to 30s. */
  timeoutMs?: number;
}

export type AIErrorCode =
  | "over_limit"
  | "rate_limited"
  | "api_error"
  | "timeout"
  | "internal"
  | "invalid_request"
  | "unmapped_model";

export type AIError =
  | { code: "over_limit"; message: string }
  | { code: "rate_limited"; retryAfterMs: number; message: string }
  | { code: "api_error"; status: number; message: string }
  | { code: "timeout"; message: string }
  | { code: "internal"; message: string }
  | { code: "invalid_request"; message: string }
  | { code: "unmapped_model"; model: string; message: string };

export type AICompletionResponse =
  | {
      ok: true;
      content: string;
      model: AIModel;
      tokenUsage: TokenUsage;
      costMicros: number;
      durationMs: number;
    }
  | { ok: false; error: AIError };

// ============================================================
// Metering — shapes for the future ai_usage_* tables (Task 0.8)
// ============================================================

export type UsageStatus = "success" | "error" | "rate_limited" | "over_limit";

export interface UsageRecord {
  id: string;
  tenantId: string;
  userId: string;
  module: string;
  capability: AICapability;
  model: AIModel;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costMicros: number;
  durationMs: number;
  status: UsageStatus;
  errorMessage: string | null;
  requestMetadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface UsageSummary {
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  totalTokens: number;
  totalCostMicros: number;
  requestCount: number;
  /** Per-module / per-capability breakdown — shape TBD by Task 0.8. */
  breakdown: Record<string, unknown>;
}

export interface UsageLimit {
  tenantId: string;
  monthlyTokenLimit: number | null; // null = unlimited
  monthlyCostLimitMicros: number;   // seeded at module activation
}
