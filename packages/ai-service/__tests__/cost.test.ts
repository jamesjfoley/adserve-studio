import { describe, expect, test } from "vitest";

import {
  calculateCostMicros,
  conservativeCostMicros,
  isModelPriced,
  UnmappedModelError,
} from "../src/cost";
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

describe("calculateCostMicros — named asymmetric billing case", () => {
  // claude-sonnet-4-6: (1000/1e6)*3e6 + (500/1e6)*15e6 = 3000 + 7500 = 10500.
  test("claude-sonnet-4-6 at 1000 in / 500 out = 10,500 micros", () => {
    expect(
      calculateCostMicros("claude-sonnet-4-6", {
        inputTokens: 1_000,
        outputTokens: 500,
        totalTokens: 1_500,
      })
    ).toBe(10_500);
  });
});

describe("calculateCostMicros — fail safe on unmapped model", () => {
  // The invariant: an unmapped model must SURFACE an error, never silently
  // return 0 (which would let real usage slip under the $50 cap).
  test("throws UnmappedModelError naming the model instead of returning 0", () => {
    expect(() =>
      calculateCostMicros("claude-not-a-real-model", ONE_MILLION_EACH)
    ).toThrow(UnmappedModelError);
    expect(() =>
      calculateCostMicros("claude-not-a-real-model", ONE_MILLION_EACH)
    ).toThrow("claude-not-a-real-model");
  });
});

describe("isModelPriced — pre-call gate predicate", () => {
  test("true for every mapped model", () => {
    expect(isModelPriced("claude-haiku-4-5-20251001")).toBe(true);
    expect(isModelPriced("claude-sonnet-4-6")).toBe(true);
    expect(isModelPriced("claude-opus-4-8")).toBe(true);
  });

  test("false for an unmapped model id", () => {
    expect(isModelPriced("claude-not-a-real-model")).toBe(false);
  });

  test("false for inherited Object.prototype keys (own-property check)", () => {
    // Guards against `"toString" in MODEL_PRICING`-style false positives.
    expect(isModelPriced("toString")).toBe(false);
    expect(isModelPriced("constructor")).toBe(false);
  });
});

describe("conservativeCostMicros — highest-rate fallback (never under-bills)", () => {
  // The most expensive known rate is opus-4-8: $5/M in + $25/M out.
  // 1M in + 1M out → 5_000_000 + 25_000_000 = 30_000_000 micros.
  test("bills 1M in + 1M out at the most expensive known rate ($30)", () => {
    expect(conservativeCostMicros(ONE_MILLION_EACH)).toBe(30_000_000);
  });

  test("is >= every individual model's exact cost for the same usage", () => {
    const usage: TokenUsage = {
      inputTokens: 1_000,
      outputTokens: 500,
      totalTokens: 1_500,
    };
    const conservative = conservativeCostMicros(usage);
    for (const model of [
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-6",
      "claude-opus-4-8",
    ]) {
      expect(conservative).toBeGreaterThanOrEqual(
        calculateCostMicros(model, usage)
      );
    }
  });

  test("zero usage costs zero even at the conservative rate", () => {
    expect(
      conservativeCostMicros({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    ).toBe(0);
  });
});
