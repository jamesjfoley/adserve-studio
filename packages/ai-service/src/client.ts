import Anthropic, {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  RateLimitError,
} from "@anthropic-ai/sdk";

import type {
  AICapability,
  AICompletionRequest,
  AICompletionResponse,
  AIError,
  AIModel,
  TokenUsage,
  UsageStatus,
} from "./types";
import { calculateCostMicros, UnmappedModelError } from "./cost";
import { resolveModelForCapability } from "./models";
import {
  checkLimits as meteringCheckLimits,
  recordUsage as meteringRecordUsage,
} from "./metering";

import * as recordCreationPrompt from "./prompts/record-creation";
import * as fieldSuggestionPrompt from "./prompts/field-suggestion";
import * as activitySummaryPrompt from "./prompts/activity-summary";
import * as smartSearchPrompt from "./prompts/smart-search";

// ============================================================
// Configuration
// ============================================================

/** Hard timeout for an individual Anthropic request when the caller
 *  doesn't override it via `request.timeoutMs`. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Output token ceiling. These capabilities are all short single-shot
 *  completions (a record, a field value, a 2–3 paragraph summary, a
 *  JSON filter blob), so a modest cap is correct and bounds cost. */
const DEFAULT_MAX_TOKENS = 1024;

/** SDK-native retry count. The SDK retries 408/409/429/5xx and honours
 *  the `retry-after` header — we do not hand-roll retry logic. */
const MAX_RETRIES = 2;

/**
 * Prompt template per capability. `complex_analysis` is reserved and has
 * no template yet — callers must supply `systemPrompt` for it.
 */
const PROMPT_BY_CAPABILITY: Partial<
  Record<AICapability, { systemPrompt: string; PROMPT_VERSION: string }>
> = {
  record_creation: recordCreationPrompt,
  field_suggestion: fieldSuggestionPrompt,
  activity_summary: activitySummaryPrompt,
  smart_search: smartSearchPrompt,
};

// ============================================================
// Injectable dependencies (the 0.7 ↔ 0.8 ↔ 1.7 seam)
// ============================================================

/**
 * Arguments handed to `recordUsage` on every call path. Mirrors the
 * `recordUsage` stub signature in `metering.ts` — Task 0.8 implements
 * the DB-backed sink against the `ai_usage_log` / `ai_usage_summary`
 * tables and swaps the default below for it (or 1.7 injects it).
 */
export interface RecordUsageInput {
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
}

export type CheckLimitsFn = (args: {
  tenantId: string;
}) => Promise<{ ok: true } | { ok: false; reason: "over_limit" }>;

export type RecordUsageFn = (record: RecordUsageInput) => Promise<unknown>;

/**
 * Dependencies `aiComplete` will use. All optional — sensible defaults
 * are defined locally so the chokepoint is fully operational in Task
 * 0.7 without the DB. Tests inject spies; Task 0.8 supplies the real
 * metering-backed `checkLimits` / `recordUsage`; Task 1.7 may inject
 * per-request.
 */
export interface AIServiceDeps {
  client?: Anthropic;
  checkLimits?: CheckLimitsFn;
  recordUsage?: RecordUsageFn;
}

/**
 * Defaults wire the real DB-backed metering (Task 0.8) so that callers
 * who don't inject `deps` still get cap enforcement and usage recording —
 * metering is safe-by-default and can't be accidentally skipped. The
 * metering functions open their own `withTenant()` transaction (scoped by
 * `record.tenantId`), so they're correct when called from a request
 * handler with no ambient transaction. Tests inject mocks via `deps`.
 */
const defaultCheckLimits: CheckLimitsFn = (args) => meteringCheckLimits(args);
const defaultRecordUsage: RecordUsageFn = (record) =>
  meteringRecordUsage(record);

// ============================================================
// Anthropic client (lazy singleton)
// ============================================================

/**
 * Thrown when `ANTHROPIC_API_KEY` is absent. `aiComplete` maps it to a
 * structured `internal` error so the missing-config case never leaks
 * past the service boundary.
 */
class MissingApiKeyError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set");
    this.name = "MissingApiKeyError";
  }
}

let cachedClient: Anthropic | null = null;

/**
 * Build (and cache) the Anthropic client from `ANTHROPIC_API_KEY`.
 *
 * The key is injected as an environment variable in every environment:
 * locally from `.env`, in production by ECS from the
 * `adserve/anthropic-api-key` Secrets Manager secret via the task
 * definition `secrets:` block — the same path as `DATABASE_URL` and the
 * Clerk keys. There is no runtime Secrets Manager SDK call.
 */
function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();
  cachedClient = new Anthropic({ apiKey, maxRetries: MAX_RETRIES });
  return cachedClient;
}

/** Test seam — reset the cached client between tests. */
export function __resetClientForTests(): void {
  cachedClient = null;
}

// ============================================================
// Error mapping
// ============================================================

/** Pull `retry-after` (seconds) off a rate-limit error's headers. */
function retryAfterMs(err: RateLimitError): number {
  const raw =
    typeof err.headers?.get === "function"
      ? err.headers.get("retry-after")
      : undefined;
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

/**
 * Map any thrown value to a structured `AIError`. Order matters:
 * subclasses (RateLimitError, BadRequestError, …) are checked before
 * the `APIError` base, and `APIConnectionTimeoutError` before its
 * `APIConnectionError` parent.
 */
function mapError(err: unknown): AIError {
  if (err instanceof MissingApiKeyError) {
    return { code: "internal", message: err.message };
  }
  if (err instanceof UnmappedModelError) {
    return { code: "unmapped_model", model: err.model, message: err.message };
  }
  if (err instanceof RateLimitError) {
    return {
      code: "rate_limited",
      retryAfterMs: retryAfterMs(err),
      message: err.message,
    };
  }
  if (
    err instanceof APIConnectionTimeoutError ||
    err instanceof APIUserAbortError
  ) {
    return { code: "timeout", message: err.message };
  }
  if (err instanceof BadRequestError) {
    return { code: "invalid_request", message: err.message };
  }
  if (err instanceof AuthenticationError) {
    return {
      code: "api_error",
      status: err.status ?? 401,
      message: err.message,
    };
  }
  if (err instanceof APIConnectionError) {
    return { code: "api_error", status: 0, message: err.message };
  }
  if (err instanceof APIError) {
    return { code: "api_error", status: err.status ?? 0, message: err.message };
  }
  return {
    code: "internal",
    message: err instanceof Error ? err.message : "Unknown error",
  };
}

/** Terminal usage status for an error. `UsageStatus` has only four
 *  members; every non-rate-limit failure records as `error`. */
function statusForError(error: AIError): UsageStatus {
  return error.code === "rate_limited" ? "rate_limited" : "error";
}

// ============================================================
// Helpers
// ============================================================

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

/** Concatenate the text blocks of an Anthropic message response. */
function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter(
      (block): block is Anthropic.Messages.TextBlock => block.type === "text"
    )
    .map((block) => block.text)
    .join("");
}

function resolveSystemPrompt(request: AICompletionRequest): {
  systemPrompt: string | undefined;
  promptVersion: string;
} {
  const template = PROMPT_BY_CAPABILITY[request.capability];
  return {
    systemPrompt: request.systemPrompt ?? template?.systemPrompt,
    promptVersion: template?.PROMPT_VERSION ?? "none",
  };
}

// ============================================================
// aiComplete — the single chokepoint
// ============================================================

/**
 * AI service entry point. Every AI call across every module flows
 * through here. It:
 *   1. Validates the request shape
 *   2. Resolves the model from `request.capability`
 *   3. Checks tenant limits (`deps.checkLimits`)
 *   4. Calls the Anthropic API with the capability's prompt template
 *   5. Emits a usage record on EVERY path (`deps.recordUsage`) attributed
 *      to the calling tenant — success, error, rate-limit, over-limit
 *   6. Returns a structured `AICompletionResponse` — NEVER throws past
 *      this boundary; errors come back as `{ ok: false, error }`.
 *
 * `deps` is the seam: defaults make it fully operational in Task 0.7;
 * Task 0.8 supplies DB-backed metering, Task 1.7 wires real endpoints.
 */
export async function aiComplete(
  request: AICompletionRequest,
  deps: AIServiceDeps = {}
): Promise<AICompletionResponse> {
  const checkLimits = deps.checkLimits ?? defaultCheckLimits;
  const recordUsage = deps.recordUsage ?? defaultRecordUsage;

  const model = resolveModelForCapability(request.capability);
  const { systemPrompt, promptVersion } = resolveSystemPrompt(request);
  const requestMetadata = { ...(request.metadata ?? {}), promptVersion };
  const startedAt = Date.now();

  // Emit-and-return helper: a usage record is written on every terminal
  // path. recordUsage failures must never break the response, so they
  // are swallowed (the persistence layer logs its own failures in 0.8).
  const emit = async (outcome: {
    tokenUsage: TokenUsage;
    costMicros: number;
    status: UsageStatus;
    errorMessage?: string;
  }): Promise<void> => {
    try {
      await recordUsage({
        tenantId: request.tenantId,
        userId: request.userId,
        module: request.module,
        capability: request.capability,
        model,
        durationMs: Date.now() - startedAt,
        requestMetadata,
        ...outcome,
      });
    } catch {
      // Intentionally swallowed — see comment above.
    }
  };

  // 1. Validate.
  if (!request.messages || request.messages.length === 0) {
    const error: AIError = {
      code: "invalid_request",
      message: "messages must be a non-empty array",
    };
    await emit({
      tokenUsage: ZERO_USAGE,
      costMicros: 0,
      status: "error",
      errorMessage: error.message,
    });
    return { ok: false, error };
  }

  // 2. Limit check (short-circuits before any API call / cost).
  let limit: Awaited<ReturnType<CheckLimitsFn>>;
  try {
    limit = await checkLimits({ tenantId: request.tenantId });
  } catch (err) {
    const error = mapError(err);
    await emit({
      tokenUsage: ZERO_USAGE,
      costMicros: 0,
      status: statusForError(error),
      errorMessage: error.message,
    });
    return { ok: false, error };
  }
  if (!limit.ok) {
    const error: AIError = {
      code: "over_limit",
      message: "Tenant has exceeded its AI usage limit",
    };
    await emit({
      tokenUsage: ZERO_USAGE,
      costMicros: 0,
      status: "over_limit",
      errorMessage: error.message,
    });
    return { ok: false, error };
  }

  // 3. Resolve the client (missing key → internal, still emits).
  let client: Anthropic;
  try {
    client = deps.client ?? getClient();
  } catch (err) {
    const error = mapError(err);
    await emit({
      tokenUsage: ZERO_USAGE,
      costMicros: 0,
      status: statusForError(error),
      errorMessage: error.message,
    });
    return { ok: false, error };
  }

  // 4. Call Anthropic.
  try {
    const response = await client.messages.create(
      {
        model,
        max_tokens: DEFAULT_MAX_TOKENS,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      },
      { timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS }
    );

    const tokenUsage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    };
    // Cost calc fails safe: an unmapped model throws rather than billing 0.
    // Handle it HERE (not via the generic catch below) so the usage row keeps
    // the REAL token counts from the response instead of ZERO_USAGE — the
    // attempt stays visible even though it's unpriced. The line-400 catch
    // remains the backstop guaranteeing nothing throws past the boundary.
    let costMicros: number;
    try {
      costMicros = calculateCostMicros(model, tokenUsage);
    } catch (err) {
      const error = mapError(err);
      await emit({
        tokenUsage,
        costMicros: 0,
        status: statusForError(error),
        errorMessage: error.message,
      });
      return { ok: false, error };
    }
    const durationMs = Date.now() - startedAt;

    await emit({ tokenUsage, costMicros, status: "success" });

    return {
      ok: true,
      content: extractText(response.content),
      model,
      tokenUsage,
      costMicros,
      durationMs,
    };
  } catch (err) {
    const error = mapError(err);
    await emit({
      tokenUsage: ZERO_USAGE,
      costMicros: 0,
      status: statusForError(error),
      errorMessage: error.message,
    });
    return { ok: false, error };
  }
}
