import { describe, expect, it } from "vitest";

import type { AgentChatMessage, AgentToolEvent } from "../types";
import { agentMutationSnapshot, kindsFromAgentMessages } from "./mutation-sync";

const now = "2026-09-06T00:00:00.000Z";

function tool(name: string, content: unknown, id = name): AgentChatMessage {
  return {
    id,
    role: "tool",
    toolName: name,
    content: JSON.stringify(content),
    createdAt: now,
  };
}

describe("kindsFromAgentMessages", () => {
  it("collects successful writes and skips failed ones", () => {
    const snapshot = kindsFromAgentMessages([
      tool("fairlx_project_create", { project: { $id: "p1", workspaceId: "ws" } }, "m1"),
      tool("fairlx_work_item_create", { workItem: { $id: "wi1", projectId: "p1" } }, "m2"),
      tool("fairlx_work_item_create", { error: "denied" }, "m3"),
      tool("fairlx_project_list", { projects: [] }, "m4"),
    ]);
    expect(snapshot.kinds).toEqual(expect.arrayContaining(["projects", "work-items", "sprints", "agent-context"]));
    expect(snapshot.fingerprint).toBe("m1|m2");
  });

  it("unwraps mcp_call results to the inner Fairlx tool", () => {
    const snapshot = kindsFromAgentMessages([
      tool(
        "mcp_call",
        { tool: "fairlx_sprint_create", result: { sprint: { $id: "s1", projectId: "p1" } } },
        "m5",
      ),
    ]);
    expect(snapshot.kinds).toEqual(expect.arrayContaining(["sprints", "work-items", "agent-context"]));
  });
});

describe("agentMutationSnapshot", () => {
  it("merges message writes with mcp_call events", () => {
    const events: AgentToolEvent[] = [
      {
        id: "e1",
        type: "mcp_call",
        title: "project create",
        payload: { server: "fairlx", tool: "fairlx_project_create" },
        createdAt: now,
        runId: "run_1",
      },
    ];
    const snapshot = agentMutationSnapshot({
      messages: [tool("fairlx_work_item_create", { workItem: { $id: "wi1" } }, "m1")],
      events,
    });
    expect(snapshot.kinds).toEqual(expect.arrayContaining(["projects", "work-items", "agent-context"]));
    expect(snapshot.fingerprint).toContain("m1");
    expect(snapshot.fingerprint).toContain("e1");
  });
});
