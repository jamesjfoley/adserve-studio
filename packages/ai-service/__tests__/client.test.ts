import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

// ------------------------------------------------------------
// Mock the Anthropic SDK at the module boundary. The mock exports:
//  - default: a constructor whose instances expose `messages.create`
//    (the shared `createMock` we drive per test)
//  - the error classes as real subclasses so `instanceof` checks inside
//    `client.ts` (which imports the SAME mocked module) behave correctly.
// No real API calls; no real Secrets Manager calls (key comes from env).
// ------------------------------------------------------------
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages: { create: typeof createMock };
    constructor(_opts: unknown) {
      this.messages = { create: createMock };
    }
  }
  class APIError extends Error {
    status: number;
    headers?: { get: (k: string) => string | null };
    constructor(
      status: number,
      message: string,
      headers?: { get: (k: string) => string | null }
    ) {
      super(message);
      this.status = status;
      this.headers = headers;
    }
  }
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class AuthenticationError extends APIError {}
  class APIConnectionError extends Error {}
  class APIConnectionTimeoutError extends APIConnectionError {}
  class APIUserAbortError extends Error {}
  return {
    default: MockAnthropic,
    APIError,
    RateLimitError,
    BadRequestError,
    AuthenticationError,
    APIConnectionError,
    APIConnectionTimeoutError,
    APIUserAbortError,
  };
});

// Task 0.8 wired the real DB-backed metering as aiComplete's default
// checkLimits/recordUsage. These client tests exercise the client only, so
// we mock metering to safe no-ops — no DB. Tests that need to observe
// emission inject their own recordUsage spy via `deps` (which overrides the
// default), and the over-limit test injects its own checkLimits.
vi.mock("../src/metering", () => ({
  checkLimits: vi.fn().mockResolvedValue({ ok: true }),
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

import {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { aiComplete, __resetClientForTests } from "../src/client";
import type { AICompletionRequest } from "../src/types";

// Helpers --------------------------------------------------------------

function baseRequest(
  over: Partial<AICompletionRequest> = {}
): AICompletionRequest {
  return {
    tenantId: "tenant-a",
    userId: "user-1",
    module: "crm",
    capability: "record_creation", // → claude-sonnet-4-6
    messages: [{ role: "user", content: "Create an account for Acme Ltd" }],
    ...over,
  };
}

function okResponse(inputTokens = 10, outputTokens = 5) {
  return {
    content: [{ type: "text", text: "hello" }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

let recordUsage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  __resetClientForTests();
  createMock.mockReset();
  recordUsage = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  // Guard against an env model override leaking into later tests.
  delete process.env.AI_MODEL_RECORD_CREATION;
});

// Client initialisation -----------------------------------------------

describe("client initialisation", () => {
  test("builds the client from ANTHROPIC_API_KEY env var (no injected client)", async () => {
    createMock.mockResolvedValue(okResponse());
    const res = await aiComplete(baseRequest(), { recordUsage });
    expect(res.ok).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  test("missing ANTHROPIC_API_KEY → internal error, no API call, but STILL emits usage", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    __resetClientForTests();

    const res = await aiComplete(baseRequest(), { recordUsage });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error.code).toBe("internal");
    expect(createMock).not.toHaveBeenCalled();
    // "Every path emits" contract — the missing-key path is no exception.
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0][0]).toMatchObject({
      status: "error",
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
  });
});

// Success + usage emission --------------------------------------------

describe("successful completion", () => {
  test("returns content + token usage + cost, and emits a success usage row", async () => {
    createMock.mockResolvedValue(okResponse(10, 5));

    const res = await aiComplete(baseRequest(), { recordUsage });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.content).toBe("hello");
    expect(res.model).toBe("claude-sonnet-4-6");
    expect(res.tokenUsage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    // claude-sonnet-4-6: (10/1e6)*3e6 + (5/1e6)*15e6 = 30 + 75 = 105
    expect(res.costMicros).toBe(105);

    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0][0]).toMatchObject({
      tenantId: "tenant-a",
      userId: "user-1",
      module: "crm",
      capability: "record_creation",
      model: "claude-sonnet-4-6",
      status: "success",
      costMicros: 105,
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    // promptVersion is stamped into requestMetadata for log correlation.
    expect(recordUsage.mock.calls[0][0].requestMetadata).toMatchObject({
      promptVersion: "v1",
    });
  });
});

// Over-limit short-circuit --------------------------------------------

describe("over-limit", () => {
  test("short-circuits before any API call and emits an over_limit row", async () => {
    const checkLimits = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "over_limit" });

    const res = await aiComplete(baseRequest(), { checkLimits, recordUsage });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error.code).toBe("over_limit");
    expect(createMock).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0][0]).toMatchObject({
      status: "over_limit",
      costMicros: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
  });
});

// Input validation ----------------------------------------------------

describe("input validation", () => {
  test("empty messages → invalid_request, no API call, emits error row", async () => {
    const res = await aiComplete(baseRequest({ messages: [] }), {
      recordUsage,
    });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error.code).toBe("invalid_request");
    expect(createMock).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0][0].status).toBe("error");
  });
});

// Error-class mapping --------------------------------------------------

describe("error mapping (each class → correct AIError + usage row)", () => {
  test("RateLimitError → rate_limited with retryAfterMs, status rate_limited", async () => {
    createMock.mockRejectedValue(
      new RateLimitError(429, "slow down", {
        get: (k: string) => (k === "retry-after" ? "12" : null),
      })
    );

    const res = await aiComplete(baseRequest(), { recordUsage });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toMatchObject({
      code: "rate_limited",
      retryAfterMs: 12000,
    });
    expect(recordUsage.mock.calls[0][0]).toMatchObject({
      status: "rate_limited",
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
  });

  test("APIConnectionTimeoutError → timeout (status error)", async () => {
    createMock.mockRejectedValue(new APIConnectionTimeoutError("timed out"));
    const res = await aiComplete(baseRequest(), { recordUsage });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error.code).toBe("timeout");
    expect(recordUsage.mock.calls[0][0].status).toBe("error");
  });

  test("AuthenticationError → api_error status 401", async () => {
    createMock.mockRejectedValue(new AuthenticationError(401, "bad key"));
    const res = await aiComplete(baseRequest(), { recordUsage });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toMatchObject({ code: "api_error", status: 401 });
  });

  test("BadRequestError → invalid_request", async () => {
    createMock.mockRejectedValue(new BadRequestError(400, "malformed"));
    const res = await aiComplete(baseRequest(), { recordUsage });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error.code).toBe("invalid_request");
  });

  test("APIConnectionError → api_error status 0", async () => {
    createMock.mockRejectedValue(new APIConnectionError("network down"));
    const res = await aiComplete(baseRequest(), { recordUsage });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toMatchObject({ code: "api_error", status: 0 });
  });

  test("generic APIError (5xx) → api_error with status", async () => {
    createMock.mockRejectedValue(new APIError(503, "overloaded"));
    const res = await aiComplete(baseRequest(), { recordUsage });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toMatchObject({ code: "api_error", status: 503 });
    expect(recordUsage.mock.calls[0][0].status).toBe("error");
  });

  test("unknown throw → internal", async () => {
    createMock.mockRejectedValue(new Error("???"));
    const res = await aiComplete(baseRequest(), { recordUsage });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error.code).toBe("internal");
  });

  test("never throws past the boundary even on a non-Error throw", async () => {
    createMock.mockRejectedValue("string failure");
    await expect(
      aiComplete(baseRequest(), { recordUsage })
    ).resolves.toMatchObject({ ok: false });
  });
});

// Unmapped model fails safe -------------------------------------------

describe("unmapped model (fail safe)", () => {
  test("resolved model absent from MODEL_PRICING → unmapped_model error, real token counts on an error row, no silent zero-cost success", async () => {
    // Env override points record_creation at a model with no pricing entry.
    process.env.AI_MODEL_RECORD_CREATION = "claude-not-a-real-model";
    // The API call itself succeeds with real, non-zero tokens; the failure
    // is post-response, at pricing time.
    createMock.mockResolvedValue(okResponse(10, 5));

    const res = await aiComplete(baseRequest(), { recordUsage });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toMatchObject({
      code: "unmapped_model",
      model: "claude-not-a-real-model",
    });
    // The Anthropic call ran (the failure is NOT a pre-call short-circuit).
    expect(createMock).toHaveBeenCalledTimes(1);
    // Exactly one usage row, status error, cost 0, but the REAL token counts
    // are preserved (not ZERO_USAGE) so the unpriced attempt stays visible.
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0][0]).toMatchObject({
      status: "error",
      costMicros: 0,
      model: "claude-not-a-real-model",
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
  });

  test("never throws past the boundary on an unmapped model", async () => {
    process.env.AI_MODEL_RECORD_CREATION = "claude-not-a-real-model";
    createMock.mockResolvedValue(okResponse(10, 5));
    await expect(
      aiComplete(baseRequest(), { recordUsage })
    ).resolves.toMatchObject({ ok: false });
  });
});

// Tenant attribution under concurrency --------------------------------

describe("tenant attribution", () => {
  test("concurrent calls attribute each usage row to its own tenant/user", async () => {
    // Resolve on a later tick so the three calls genuinely interleave.
    createMock.mockImplementation(async () => {
      await Promise.resolve();
      return okResponse(1, 1);
    });

    const calls = [
      baseRequest({ tenantId: "tenant-a", userId: "user-a" }),
      baseRequest({ tenantId: "tenant-b", userId: "user-b" }),
      baseRequest({ tenantId: "tenant-c", userId: "user-c" }),
    ];

    const results = await Promise.all(
      calls.map((req) => aiComplete(req, { recordUsage }))
    );

    expect(results.every((r) => r.ok)).toBe(true);
    expect(recordUsage).toHaveBeenCalledTimes(3);

    const emitted = recordUsage.mock.calls.map((c) => ({
      tenantId: c[0].tenantId,
      userId: c[0].userId,
    }));
    expect(emitted).toEqual(
      expect.arrayContaining([
        { tenantId: "tenant-a", userId: "user-a" },
        { tenantId: "tenant-b", userId: "user-b" },
        { tenantId: "tenant-c", userId: "user-c" },
      ])
    );
    // No tenant pairs up with the wrong user (attribution not crossed).
    for (const e of emitted) {
      expect(e.userId).toBe(e.tenantId.replace("tenant-", "user-"));
    }
  });
});

// recordUsage failures must not break the response ---------------------

describe("usage-sink resilience", () => {
  test("a throwing recordUsage does not break a successful response", async () => {
    createMock.mockResolvedValue(okResponse());
    const failingSink = vi.fn().mockRejectedValue(new Error("db down"));

    const res = await aiComplete(baseRequest(), { recordUsage: failingSink });

    expect(res.ok).toBe(true);
    expect(failingSink).toHaveBeenCalledTimes(1);
  });
});
