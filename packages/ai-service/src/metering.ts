import type {
  UsageRecord,
  UsageSummary,
  UsageLimit,
  TokenUsage,
  AICapability,
  AIModel,
  UsageStatus,
} from "./types";

/**
 * Metering layer — STUB.
 *
 * Implementation lands in Task 0.8. Backed by the RLS-protected tables
 * `ai_usage_log`, `ai_usage_summary`, `ai_usage_limits` (created by
 * Task 0.8's migration).
 */

/**
 * Check whether the tenant is currently within its cost and rate
 * limits. Called before any API call. Returns `over_limit` to short-
 * circuit the call.
 */
export async function checkLimits(_args: {
  tenantId: string;
}): Promise<{ ok: true } | { ok: false; reason: "over_limit" }> {
  throw new Error("checkLimits not implemented (Task 0.8)");
}

/**
 * Record a completed (or failed) AI call to `ai_usage_log` + roll up
 * to the current period's `ai_usage_summary`. Always writes — even
 * errored calls and over-limit attempts — so we have full visibility
 * into what tenants tried to do.
 */
export async function recordUsage(_record: {
  tenantId: string;
  userId: string;
  module: string;
  capability: AICapability;
  model: AIModel;
  tokenUsage: TokenUsage;
  costMicros: number;
  durationMs: number;
  status: UsageStatus;
  errorMessage?: string;
  requestMetadata?: Record<string, unknown>;
}): Promise<UsageRecord> {
  throw new Error("recordUsage not implemented (Task 0.8)");
}

/**
 * Fetch the current billing-period usage summary for a tenant.
 * Used by `/api/admin/ai-usage`.
 */
export async function getCurrentPeriodSummary(_args: {
  tenantId: string;
}): Promise<UsageSummary | null> {
  throw new Error("getCurrentPeriodSummary not implemented (Task 0.8)");
}

/**
 * Fetch a tenant's configured usage limits.
 */
export async function getUsageLimits(_args: {
  tenantId: string;
}): Promise<UsageLimit | null> {
  throw new Error("getUsageLimits not implemented (Task 0.8)");
}

/**
 * Update a tenant's usage limits. Super-admin only.
 */
export async function setUsageLimits(_args: {
  tenantId: string;
  monthlyTokenLimit?: number | null;
  monthlyCostLimitMicros?: number;
}): Promise<UsageLimit> {
  throw new Error("setUsageLimits not implemented (Task 0.8)");
}
