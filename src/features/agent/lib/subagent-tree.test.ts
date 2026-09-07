import { describe, expect, it } from "vitest";

import type { AgentToolEvent } from "../types";
import { buildAgentCrew, specialistDisplayName } from "./subagent-tree";

function event(
  type: AgentToolEvent["type"],
  title: string,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
): AgentToolEvent {
  return {
    id,
    type,
    title,
    payload,
    createdAt: new Date().toISOString(),
    runId: "run1",
  };
}

describe("subagent tree", () => {
  it("names known specialists", () => {
    expect(specialistDisplayName("researcher")).toBe("Researcher");
    expect(specialistDisplayName("planner")).toBe("Planner");
  });

  it("returns an idle orchestrator with no specialists", () => {
    const crew = buildAgentCrew([], "idle");
    expect(crew.total).toBe(0);
    expect(crew.live).toBe(0);
    expect(crew.orchestratorStatus).toBe("idle");
    expect(crew.children).toEqual([]);
  });

  it("groups live specialists under the orchestrator", () => {
    const crew = buildAgentCrew(
      [
        event("subagent_started", "researcher started · Market", {
          id: "r1",
          specialist: "researcher",
          parent: "orchestrator",
          task: "Research plugins",
          subject: "Market",
        }),
        event("subagent_progress", "researcher thinking", { id: "r1" }),
        event("subagent_started", "planner started", {
          id: "p1",
          specialist: "planner",
          parent: "orchestrator",
          task: "Write the plan",
        }),
        event("subagent_done", "planner finished", { id: "p1" }),
      ],
      "running",
    );
    expect(crew.orchestratorStatus).toBe("working");
    expect(crew.live).toBe(1);
    expect(crew.total).toBe(2);
    expect(crew.types.map((item) => item.specialist).sort()).toEqual(["planner", "researcher"]);
    expect(crew.children).toHaveLength(2);
    expect(crew.children[0]?.label).toBe("Market");
    expect(crew.children[0]?.status).toBe("working");
    expect(crew.children[0]?.lastAction).toBe("researcher thinking");
    expect(crew.children[1]?.status).toBe("done");
    expect(crew.directLive).toBe(1);
    expect(crew.directTotal).toBe(2);
    expect(crew.nestedTotal).toBe(0);
    expect(crew.children[0]?.modelName).toBe("DeepSeek V4 Flash");
  });

  it("nests a specialist under the parent that launched it", () => {
    const crew = buildAgentCrew(
      [
        event("subagent_started", "planner started", {
          id: "p1",
          specialist: "planner",
          parent: "orchestrator",
          task: "Plan the plugin",
        }),
        event("subagent_started", "builder started · Auth", {
          id: "b1",
          specialist: "builder",
          parent: "planner",
          task: "Create auth stories",
          subject: "Auth",
        }),
      ],
      "running",
    );
    expect(crew.children).toHaveLength(1);
    expect(crew.children[0]?.specialist).toBe("planner");
    expect(crew.children[0]?.children).toHaveLength(1);
    expect(crew.children[0]?.children[0]?.label).toBe("Auth");
    expect(crew.types.find((item) => item.specialist === "builder")?.total).toBe(1);
    expect(crew.directTotal).toBe(1);
    expect(crew.nestedTotal).toBe(1);
    expect(crew.nestedLive).toBe(1);
  });

  it("marks every specialist done when the run has finished", () => {
    const crew = buildAgentCrew(
      [
        event("subagent_started", "researcher started", {
          id: "r1",
          specialist: "researcher",
          parent: "orchestrator",
          task: "Look around",
        }),
      ],
      "completed",
    );
    expect(crew.orchestratorStatus).toBe("done");
    expect(crew.live).toBe(0);
    expect(crew.children[0]?.status).toBe("done");
  });

  it("attaches live models and activity to the orchestrator and specialists", () => {
    const crew = buildAgentCrew(
      [
        event("thought", "Working", {}),
        event("llm_usage", "Model call", {
          role: "orchestrator",
          displayName: "Grok 4.6",
          modelId: "grok-4.6",
          promptTokens: 800,
          completionTokens: 40,
          totalTokens: 840,
          billed: true,
          costUSD: 0.01,
        }),
        event("subagent_started", "researcher started · Market", {
          id: "r1",
          specialist: "researcher",
          parent: "orchestrator",
          task: "Research plugins",
          subject: "Market",
        }),
        event("github_list_files", "Listed repo files", { subagentId: "r1", specialist: "researcher" }),
        event("llm_usage", "researcher · model call", {
          role: "subagent",
          specialist: "researcher",
          subagentId: "r1",
          operationId: "run1:sub:r1:0",
          displayName: "DeepSeek V4 Flash",
          modelId: "deepseek-flash",
          promptTokens: 500,
          completionTokens: 20,
          totalTokens: 520,
          billed: true,
          costUSD: 0.001,
        }),
        event("subagent_progress", "researcher thinking", { id: "r1" }),
      ],
      "running",
      { orchestratorModelName: "Grok 4.6", workerModelName: "DeepSeek V4 Flash" },
    );

    expect(crew.orchestratorModelName).toBe("Grok 4.6");
    expect(crew.workerModelName).toBe("DeepSeek V4 Flash");
    expect(crew.orchestratorCalls).toBe(1);
    expect(crew.orchestratorActivity.some((item) => item.title === "Working")).toBe(true);
    expect(crew.children[0]?.modelName).toBe("DeepSeek V4 Flash");
    expect(crew.children[0]?.calls).toBe(1);
    expect(crew.children[0]?.tokens).toBe(520);
    expect(crew.children[0]?.activity.map((item) => item.title)).toEqual(
      expect.arrayContaining(["Listed repo files", "researcher thinking"]),
    );
    expect(crew.roster.find((item) => item.specialist === "researcher")?.live).toBe(1);
  });

  it("resolves a worker model from usage operation ids when payloads omit subagentId", () => {
    const crew = buildAgentCrew(
      [
        event("subagent_started", "builder started", {
          id: "b1",
          specialist: "builder",
          parent: "orchestrator",
          task: "Create stories",
        }),
        event("llm_usage", "builder · model call", {
          role: "subagent",
          specialist: "builder",
          operationId: "abc:sub:b1:1",
          displayName: "DeepSeek V4 Pro",
          promptTokens: 100,
          completionTokens: 10,
          totalTokens: 110,
          billed: true,
        }),
      ],
      "running",
    );
    expect(crew.children[0]?.modelName).toBe("DeepSeek V4 Pro");
    expect(crew.children[0]?.calls).toBe(1);
  });
});
