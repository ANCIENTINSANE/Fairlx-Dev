/**
 * Working prompt windows per platform model.
 *
 * Native context can be much larger (DeepSeek V4 Flash and GPT-5.6 Luna ~1M,
 * Grok 4.6 200k on Azure Foundry / 500k native). We cap the prompt we send so
 * occupancy stays honest and a long tool loop cannot bill a million-token call.
 * Output is reserved inside the provider's total context where that matters.
 */
export type ModelContextWindow = {
  maxInputTokens: number;
  maxOutputTokens: number;
};

const DEFAULT_WINDOW: ModelContextWindow = {
  maxInputTokens: 128_000,
  maxOutputTokens: 16_384,
};

export function workingContextWindow(modelId?: string | null): ModelContextWindow {
  const id = (modelId || "").toLowerCase();
  if (!id) return DEFAULT_WINDOW;
  if (id.includes("luna") || id.includes("gpt-5.6")) {
    return { maxInputTokens: 256_000, maxOutputTokens: 128_000 };
  }
  if (id.includes("deepseek")) {
    return { maxInputTokens: 256_000, maxOutputTokens: 16_384 };
  }
  if (id.includes("grok")) {
    // Azure Foundry grok-4.6 is a 200k total window (input + output).
    return { maxInputTokens: 160_000, maxOutputTokens: 32_000 };
  }
  return DEFAULT_WINDOW;
}

export function withWorkingContextWindow<T extends { id?: string; modelId?: string; maxInputTokens?: number; maxOutputTokens?: number }>(
  model: T,
): T {
  const window = workingContextWindow(model.modelId || model.id);
  return {
    ...model,
    maxInputTokens: window.maxInputTokens,
    maxOutputTokens: window.maxOutputTokens,
  };
}
