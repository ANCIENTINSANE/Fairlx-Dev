import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEEPSEEK_FLASH_MODEL_ID,
  DEEPSEEK_PRO_MODEL_ID,
  FOUNDRY_GPT_LUNA_MODEL_ID,
  FOUNDRY_GPT_SOL_MODEL_ID,
} from "../constants";
import { defaultAiStoredConfig } from "./defaults";
import {
  resolveOrchestratorTarget,
  resolveReviewerTarget,
  resolveSessionBuilderTarget,
  resolveWorkerTarget,
  specialistChatTarget,
} from "./runtime";

describe("model router by job type", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AGENT_GROK_AZURE_API_KEY", "test-grok-key");
    vi.stubEnv("AGENT_DEEPSEEK_AZURE_API_KEY", "test-deepseek-key");
    vi.stubEnv("AGENT_FOUNDRY_AZURE_API_KEY", "test-foundry-key");
    vi.stubEnv("AGENT_FOUNDRY_SOL_AZURE_DEPLOYMENT", "gpt-5.6-sol");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("routes README/inspect and pre-accept build work to Flash", () => {
    const stored = {
      ...defaultAiStoredConfig(),
      mode: "manual" as const,
      selectedModelId: FOUNDRY_GPT_SOL_MODEL_ID,
    };
    const inspect = resolveOrchestratorTarget(stored, "tell me about this repo", false);
    const building = resolveOrchestratorTarget(stored, "start building the project", false);
    const afterAccept = resolveOrchestratorTarget(stored, "start building the project", true);
    const worker = resolveWorkerTarget(stored);
    expect(inspect.modelId).toBe(DEEPSEEK_FLASH_MODEL_ID);
    expect(building.modelId).toBe(DEEPSEEK_FLASH_MODEL_ID);
    expect(afterAccept.modelId).toBe(FOUNDRY_GPT_SOL_MODEL_ID);
    expect(worker.modelId).toBe(DEEPSEEK_FLASH_MODEL_ID);
  });

  it("uses Sol/Pro for builder and git only after the plan is accepted", () => {
    const stored = defaultAiStoredConfig();
    const worker = resolveWorkerTarget(stored);
    const builder = resolveSessionBuilderTarget(stored);
    const reviewer = resolveReviewerTarget(stored);
    const targets = { worker, builder, reviewer };
    expect(specialistChatTarget("planner", targets, false).modelId).toBe(DEEPSEEK_FLASH_MODEL_ID);
    expect(specialistChatTarget("builder", targets, false).modelId).toBe(DEEPSEEK_FLASH_MODEL_ID);
    const afterAccept = specialistChatTarget("builder", targets, true);
    expect([FOUNDRY_GPT_SOL_MODEL_ID, DEEPSEEK_PRO_MODEL_ID]).toContain(afterAccept.modelId);
    expect(specialistChatTarget("git", targets, true).modelId).toBe(afterAccept.modelId);
    expect(specialistChatTarget("reviewer", targets, true).modelId).toBe(FOUNDRY_GPT_LUNA_MODEL_ID);
  });
});
