import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import type { AIError } from "@adserve/ai-service";
import { getTenantContextOrNull, type TenantContext } from "@/lib/permissions";

/**
 * Shared helpers for the Task 1.7 AI endpoints.
 */

/**
 * Resolve the tenant context WITHOUT a single up-front permission check, so a
 * route can apply an any-of (create OR update) or all-of (account.read AND
 * activity.read) rule itself. 401 if not signed in, 403 if not a tenant user.
 */
export async function resolveTenantCtx(): Promise<
  { ctx: TenantContext; error: null } | { ctx: null; error: NextResponse }
> {
  const { userId } = await auth();
  if (!userId) {
    return {
      ctx: null,
      error: NextResponse.json({ error: "Unauthenticated" }, { status: 401 }),
    };
  }
  const ctx = await getTenantContextOrNull();
  if (!ctx) {
    return {
      ctx: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ctx, error: null };
}

/** Map an AIError from the service layer to an HTTP response. */
export function aiErrorResponse(error: AIError): NextResponse {
  switch (error.code) {
    case "over_limit":
      return NextResponse.json(
        { error: "AI usage limit reached for this month" },
        { status: 429 }
      );
    case "rate_limited":
      return NextResponse.json(
        { error: "AI is busy, please retry shortly" },
        {
          status: 429,
          headers: error.retryAfterMs
            ? { "Retry-After": String(Math.ceil(error.retryAfterMs / 1000)) }
            : undefined,
        }
      );
    case "timeout":
      return NextResponse.json(
        { error: "AI request timed out" },
        { status: 504 }
      );
    case "invalid_request":
    case "api_error":
    case "internal":
    default:
      return NextResponse.json({ error: "AI service error" }, { status: 502 });
  }
}

/**
 * Parse JSON the model was asked to return. The capability system prompts
 * forbid code fences, but model adherence is probabilistic — strip a single
 * leading/trailing ```json fence defensively before parsing. No further
 * repair heuristics: anything still unparseable falls through to `ok: false`,
 * which the caller maps to a 502 "malformed output".
 */
export function parseAiJson(
  content: string
): { ok: true; value: unknown } | { ok: false } {
  let s = content.trim();
  if (s.startsWith("```")) {
    s = s
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
}

/** A fresh 502 for unparseable model output (responses are single-use). */
export function malformedAiOutput(): NextResponse {
  return NextResponse.json(
    { error: "AI returned malformed output" },
    { status: 502 }
  );
}
