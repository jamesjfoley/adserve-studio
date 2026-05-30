import { describe, expect, test } from "vitest";

import { calculateCostMicros } from "../src/cost";
import type { AIModel, TokenUsage } from "../src/types";

/**
 * Price-table lock. Asserts the cost of 1M input + 1M output tokens per
 * current model as HARDCODED microdollar literals — deliberately NOT
 * derived from `MODEL_PRICING` (a test that reads the same constant it is
 * meant to guard catches nothing). If a list price changes in `cost.ts`,
 * this test must fail and force a conscious update — the cap depends on
 * these numbers being right.
 *
 * 1M in + 1M out means the expected value == inputPerMToken + outputPerMToken:
 *   haiku-4-5  $1 + $5  = $6
 *   sonnet-4-6 $3 + $15 = $18
 *   opus-4-8   $5 + $25 = $30
 */
const ONE_MILLION_EACH: TokenUsage = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  totalTokens: 2_000_000,
};

describe("calculateCostMicros — price table lock (1M in + 1M out)", () => {
  const cases: Array<[AIModel, number]> = [
    ["claude-haiku-4-5-20251001", 6_000_000],
    ["claude-sonnet-4-6", 18_000_000],
    ["claude-opus-4-8", 30_000_000],
  ];

  test.each(cases)("%s costs %d micros", (model, expected) => {
    expect(calculateCostMicros(model, ONE_MILLION_EACH)).toBe(expected);
  });
});
