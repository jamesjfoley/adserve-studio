import { NextRequest, NextResponse } from "next/server";
import { setUsageLimits } from "@adserve/ai-service";
import { apiRequireSuperAdmin } from "@/lib/super-admin";

type Params = { params: Promise<{ tenantId: string }> };

/**
 * PATCH /api/super-admin/ai-usage/[tenantId]/limits — adjust a tenant's
 * AI usage cap. Super-admin only. Body (both optional, at least one
 * required):
 *   { monthlyCostLimitMicros?: number, monthlyTokenLimit?: number | null }
 * `monthlyCostLimitMicros` is microdollars ($1 = 1,000,000).
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await apiRequireSuperAdmin();
  if (auth.error) return auth.error;
  const { tenantId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { monthlyCostLimitMicros, monthlyTokenLimit } = (body ?? {}) as {
    monthlyCostLimitMicros?: unknown;
    monthlyTokenLimit?: unknown;
  };

  const update: {
    tenantId: string;
    monthlyCostLimitMicros?: number;
    monthlyTokenLimit?: number | null;
  } = { tenantId };

  if (monthlyCostLimitMicros !== undefined) {
    if (
      typeof monthlyCostLimitMicros !== "number" ||
      !Number.isInteger(monthlyCostLimitMicros) ||
      monthlyCostLimitMicros < 0
    ) {
      return NextResponse.json(
        { error: "monthlyCostLimitMicros must be a non-negative integer" },
        { status: 400 }
      );
    }
    update.monthlyCostLimitMicros = monthlyCostLimitMicros;
  }

  if (monthlyTokenLimit !== undefined) {
    if (
      monthlyTokenLimit !== null &&
      (typeof monthlyTokenLimit !== "number" ||
        !Number.isInteger(monthlyTokenLimit) ||
        monthlyTokenLimit < 0)
    ) {
      return NextResponse.json(
        { error: "monthlyTokenLimit must be a non-negative integer or null" },
        { status: 400 }
      );
    }
    update.monthlyTokenLimit = monthlyTokenLimit;
  }

  if (
    update.monthlyCostLimitMicros === undefined &&
    update.monthlyTokenLimit === undefined
  ) {
    return NextResponse.json(
      { error: "Provide monthlyCostLimitMicros and/or monthlyTokenLimit" },
      { status: 400 }
    );
  }

  const limits = await setUsageLimits(update);
  return NextResponse.json({ limits });
}
