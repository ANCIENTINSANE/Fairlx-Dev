import { describe, expect, it } from "vitest";

import { withWorkingContextWindow, workingContextWindow } from "./model-context";

describe("workingContextWindow", () => {
  it("gives DeepSeek and Luna a 256k working prompt window", () => {
    expect(workingContextWindow("DeepSeek-V4-Flash").maxInputTokens).toBe(256_000);
    expect(workingContextWindow("gpt-5.6-luna").maxInputTokens).toBe(256_000);
  });

  it("keeps Grok under the Azure Foundry 200k total window", () => {
    const grok = workingContextWindow("grok-4.6");
    expect(grok.maxInputTokens + grok.maxOutputTokens).toBeLessThanOrEqual(200_000);
    expect(grok.maxInputTokens).toBe(160_000);
  });

  it("overlays stored 64k platform models", () => {
    const next = withWorkingContextWindow({
      id: "deepseek-flash",
      modelId: "DeepSeek-V4-Flash",
      maxInputTokens: 64_000,
      maxOutputTokens: 8_192,
    });
    expect(next.maxInputTokens).toBe(256_000);
  });
});
