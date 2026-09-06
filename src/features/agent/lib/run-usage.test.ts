import { describe, expect, it } from "vitest";

import { calculateCustomerTokenCostUSD } from "@/lib/ai-billing";
import type { AgentToolEvent } from "../types";
import {
  aggregateLlmUsage,
  cacheHitPercent,
  formatCompactUsageLine,
  formatPricePerMillion,
  formatUsd,
} from "./run-usage";

function usageEvent(payload: Record<string, unknown>): AgentToolEvent {
  return {
    id: crypto.randomUUID(),
    type: "llm_usage",
    title: "usage",
    payload,
    createdAt: new Date().toISOString(),
    runId: "run1",
  };
}

describe("run usage", () => {
  it("aggregates orchestrator and subagent token costs", () => {
    const summary = aggregateLlmUsage([
      usageEvent({
        role: "orchestrator",
        displayName: "GPT-5.6 Luna",
        model: "gpt-5.6-luna",
        modelId: "gpt-5.6-luna",
        promptTokens: 1000,
        completionTokens: 200,
        cachedTokens: 400,
        totalTokens: 1200,
        billed: true,
        costUSD: 0.002,
        providerCostUSD: 0.0017,
        inputPricePerMillionTokens: 0.2,
        outputPricePerMillionTokens: 1.2,
        cachedInputPricePerMillionTokens: 0.02,
        markup: 1.15,
        cacheHitPercent: 40,
      }),
      usageEvent({
        role: "subagent",
        specialist: "builder",
        displayName: "DeepSeek V4 Flash",
        promptTokens: 500,
        completionTokens: 80,
        cachedTokens: 0,
        totalTokens: 580,
        billed: true,
        costUSD: 0.001,
        providerCostUSD: 0.0008,
        inputPricePerMillionTokens: 0.14,
        outputPricePerMillionTokens: 0.28,
        cachedInputPricePerMillionTokens: 0.014,
      }),
    ]);
    expect(summary?.calls).toBe(2);
    expect(summary?.subagentCalls).toBe(1);
    expect(summary?.promptTokens).toBe(1500);
    expect(summary?.completionTokens).toBe(280);
    expect(summary?.cachedTokens).toBe(400);
    expect(summary?.totalTokens).toBe(1780);
    expect(summary?.costUSD).toBeCloseTo(
      calculateCustomerTokenCostUSD(
        { inputPricePerMillionTokens: 0.2, outputPricePerMillionTokens: 1.2, cachedInputPricePerMillionTokens: 0.02 },
        1000,
        200,
        400,
      ).costUSD +
        calculateCustomerTokenCostUSD(
          { inputPricePerMillionTokens: 0.14, outputPricePerMillionTokens: 0.28, cachedInputPricePerMillionTokens: 0.014 },
          500,
          80,
          0,
        ).costUSD,
    );
    expect(summary?.cacheHitPercent).toBeCloseTo(cacheHitPercent(1500, 400));
    expect(summary?.models).toEqual(["GPT-5.6 Luna", "DeepSeek V4 Flash"]);
  });

  it("collapses three Grok calls into one compact usage line", () => {
    const summary = aggregateLlmUsage([
      usageEvent({
        displayName: "Grok 4.6",
        promptTokens: 8000,
        completionTokens: 388,
        cachedTokens: 0,
        totalTokens: 8388,
        billed: true,
        costUSD: 0.0187,
        cacheHitPercent: 0,
      }),
      usageEvent({
        displayName: "Grok 4.6",
        promptTokens: 11000,
        completionTokens: 365,
        cachedTokens: 7700,
        totalTokens: 11365,
        billed: true,
        costUSD: 0.0127,
        cacheHitPercent: 70,
      }),
      usageEvent({
        displayName: "Grok 4.6",
        promptTokens: 9500,
        completionTokens: 284,
        cachedTokens: 8170,
        totalTokens: 9784,
        billed: true,
        costUSD: 0.0085,
        cacheHitPercent: 86,
      }),
    ]);
    expect(summary?.calls).toBe(3);
    expect(summary?.models).toEqual(["Grok 4.6"]);
    expect(summary?.totalTokens).toBe(29537);
    expect(summary?.costUSD).toBeCloseTo(0.0399);
    expect(formatCompactUsageLine(summary!)).toMatch(/^Grok 4\.6 · 29,537 tokens · \$0\.0/);
    expect(formatCompactUsageLine(summary!)).toContain("3 calls");
  });

  it("recovers usage from slimmed title and detail", () => {
    const summary = aggregateLlmUsage([
      {
        id: "u1",
        type: "llm_usage",
        title: "Grok 4.6 · 8,388 tokens",
        detail: "$0.0187 · 0% cache",
        createdAt: new Date().toISOString(),
        runId: "run1",
      },
      {
        id: "u2",
        type: "llm_usage",
        title: "Grok 4.6 · 11,365 tokens",
        detail: "$0.0127 · 70% cache",
        createdAt: new Date().toISOString(),
        runId: "run1",
      },
    ]);
    expect(summary?.calls).toBe(2);
    expect(summary?.models).toEqual(["Grok 4.6"]);
    expect(summary?.totalTokens).toBe(19753);
  });

  it("formats small USD amounts without rounding to zero", () => {
    expect(formatUsd(0.0023)).toBe("$0.0023");
    expect(formatUsd(0.014694)).toBe("$0.014694");
    expect(formatUsd(0.015)).toBe("$0.015");
    expect(formatPricePerMillion(0.02)).toBe("$0.020");
  });

  it("rebills Luna totals from tokens × rates × 15% instead of a rounded stored cost", () => {
    const luna = {
      inputPricePerMillionTokens: 0.2,
      outputPricePerMillionTokens: 1.2,
      cachedInputPricePerMillionTokens: 0.02,
    };
    const billed = calculateCustomerTokenCostUSD(luna, 54_065, 5_395, 25_056);
    const summary = aggregateLlmUsage([
      usageEvent({
        role: "orchestrator",
        displayName: "GPT-5.6 Luna",
        model: "gpt-5.6-luna",
        modelId: "gpt-5.6-luna",
        promptTokens: 54_065,
        completionTokens: 5_395,
        cachedTokens: 25_056,
        totalTokens: 99_999,
        billed: true,
        costUSD: 0.015,
        providerCostUSD: 0.013,
        ...luna,
        markup: 1.15,
        cacheHitPercent: 40,
      }),
    ]);
    expect(summary?.totalTokens).toBe(59_460);
    expect(summary?.promptTokens + summary!.completionTokens).toBe(summary?.totalTokens);
    expect(summary?.costUSD).toBe(billed.costUSD);
    expect(Math.round(summary!.cacheHitPercent)).toBe(46);
    expect(formatUsd(summary!.costUSD)).not.toBe("$0.015");
    expect(formatCompactUsageLine(summary!)).toContain("59,460 tokens");
    expect(formatCompactUsageLine(summary!)).toContain(formatUsd(billed.costUSD));
  });
});
