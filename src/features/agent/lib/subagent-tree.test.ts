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
});
