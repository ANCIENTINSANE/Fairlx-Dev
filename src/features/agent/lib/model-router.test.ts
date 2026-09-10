import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEEPSEEK_FLASH_MODEL_ID,
  FOUNDRY_GPT_LUNA_MODEL_ID,
  FOUNDRY_GPT_SOL_MODEL_ID,
} from "../constants";
import { defaultAiStoredConfig } from "./defaults";
import { classifyRouterTask, routeModel } from "./fairlx-router";
import {
  resolveOrchestratorTarget,
  resolveReviewerTarget,
  resolveSessionBuilderTarget,
  resolveWorkerTarget,
  specialistChatTarget,
} from "./runtime";

describe("Fairlx Router", () => {
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

  describe("task classification", () => {
    it("routes short conversational turns to quick_chat", () => {
      expect(classifyRouterTask("thanks, that works").task).toBe("quick_chat");
      expect(classifyRouterTask("what is this repo about?").task).toBe("inspect");
    });

    it("detects design, coding, debug, review and planning", () => {
      expect(classifyRouterTask("make the landing page look beautiful with a new colour palette").task).toBe("design");
      expect(classifyRouterTask("implement the checkout API endpoint in Next.js").task).toBe("coding");
      expect(classifyRouterTask("TypeError: cannot read property of undefined at render").task).toBe("debug");
      expect(classifyRouterTask("review this PR for security issues").task).toBe("review");
      expect(classifyRouterTask("give me a roadmap and phases for the mobile app").task).toBe("planning");
    });
  });

  describe("manual (pinned) mode", () => {
    it("uses the pinned model for every role, regardless of task", () => {
      const stored = {
        ...defaultAiStoredConfig(),
        mode: "manual" as const,
        selectedModelId: FOUNDRY_GPT_SOL_MODEL_ID,
      };
      expect(resolveOrchestratorTarget(stored, "tell me about this repo", false).modelId).toBe(FOUNDRY_GPT_SOL_MODEL_ID);
      expect(resolveOrchestratorTarget(stored, "start building the project", false).modelId).toBe(FOUNDRY_GPT_SOL_MODEL_ID);
      expect(resolveOrchestratorTarget(stored, "thanks", true).modelId).toBe(FOUNDRY_GPT_SOL_MODEL_ID);
      expect(resolveWorkerTarget(stored).modelId).toBe(FOUNDRY_GPT_SOL_MODEL_ID);
      expect(resolveSessionBuilderTarget(stored).modelId).toBe(FOUNDRY_GPT_SOL_MODEL_ID);
      expect(resolveReviewerTarget(stored).modelId).toBe(FOUNDRY_GPT_SOL_MODEL_ID);
      const decision = routeModel(stored, { role: "orchestrator", userText: "hi" });
      expect(decision.pinned).toBe(true);
    });

    it("keeps Flash pinned when the user picked Flash", () => {
      const stored = {
        ...defaultAiStoredConfig(),
        mode: "manual" as const,
        selectedModelId: DEEPSEEK_FLASH_MODEL_ID,
      };
      expect(resolveSessionBuilderTarget(stored).modelId).toBe(DEEPSEEK_FLASH_MODEL_ID);
      expect(resolveReviewerTarget(stored).modelId).toBe(DEEPSEEK_FLASH_MODEL_ID);
    });
  });

  describe("auto mode", () => {
    it("sends quick and inspect turns to the fastest model and heavy work to the strongest", () => {
      const stored = { ...defaultAiStoredConfig(), mode: "auto" as const };
      const inspect = resolveOrchestratorTarget(stored, "tell me about this repo", false);
      const quick = resolveOrchestratorTarget(stored, "ok sounds good", false);
      const build = resolveOrchestratorTarget(stored, "implement the billing API and migrate the schema", true);
      expect(inspect.modelId).toBe(DEEPSEEK_FLASH_MODEL_ID);
      expect(quick.modelId).toBe(DEEPSEEK_FLASH_MODEL_ID);
      expect(build.modelId).toBe(FOUNDRY_GPT_SOL_MODEL_ID);
      expect(build.route?.pinned).toBe(false);
      expect(build.route?.task).toBe("coding");
    });

    it("uses fast worker before the plan is accepted and the builder model after", () => {
      const stored = defaultAiStoredConfig();
      const worker = resolveWorkerTarget(stored);
      const builder = resolveSessionBuilderTarget(stored, true);
      const reviewer = resolveReviewerTarget(stored);
      const targets = { worker, builder, reviewer };
      expect(specialistChatTarget("planner", targets, false).modelId).toBe(DEEPSEEK_FLASH_MODEL_ID);
      expect(specialistChatTarget("builder", targets, false).modelId).toBe(DEEPSEEK_FLASH_MODEL_ID);
      expect(specialistChatTarget("builder", targets, true).modelId).toBe(FOUNDRY_GPT_SOL_MODEL_ID);
      expect(specialistChatTarget("git", targets, true).modelId).toBe(FOUNDRY_GPT_SOL_MODEL_ID);
      expect(specialistChatTarget("reviewer", targets, true).modelId).toBe(FOUNDRY_GPT_LUNA_MODEL_ID);
    });

    it("explains its decision", () => {
      const stored = { ...defaultAiStoredConfig(), mode: "auto" as const };
      const decision = routeModel(stored, { role: "orchestrator", userText: "redesign the hero section" });
      expect(decision.task).toBe("design");
      expect(decision.reason).toMatch(/Fairlx Router picked/);
    });
  });
});
