import { describe, expect, it } from "vitest";

import type { AgentAutomation } from "../types";
import {
  automationMatchesEvent,
  automationTemplates,
  compactFlow,
  compileAutomationPrompt,
  orderedSteps,
  validateFlow,
  type AutomationEvent,
} from "./automation-flow";

function automation(overrides: Partial<AgentAutomation> = {}): AgentAutomation {
  const template = automationTemplates().find((entry) => entry.id === "bug-fix-loop")!;
  return {
    id: "auto-1",
    name: template.name,
    description: template.description,
    trigger: "work_item_created",
    action: "",
    enabled: true,
    createdAt: new Date().toISOString(),
    flow: template.flow,
    ...overrides,
  };
}

const bugEvent: AutomationEvent = {
  kind: "work_item_created",
  workspaceId: "ws1",
  projectId: "p1",
  workItem: { id: "wi1", key: "WEB-12", title: "Login button crashes", type: "BUG", priority: "HIGH", status: "TODO" },
};

describe("automation flow", () => {
  it("ships valid templates", () => {
    for (const template of automationTemplates()) {
      expect(validateFlow(template.flow)).toEqual([]);
    }
  });

  it("flags flows without a trigger or with dangling edges", () => {
    expect(validateFlow({ version: 1, nodes: [], edges: [] })).toEqual(["Add a trigger node to start the loop."]);
    const flow = automationTemplates()[0].flow;
    const broken = { ...flow, edges: [...flow.edges, { id: "x", from: flow.nodes[0].id, to: "missing" }] };
    expect(validateFlow(broken).some((problem) => /no longer exists/i.test(problem))).toBe(true);
  });

  it("matches events by trigger kind, item type, and scope", () => {
    expect(automationMatchesEvent(automation(), bugEvent)).toBe(true);
    expect(automationMatchesEvent(automation({ enabled: false }), bugEvent)).toBe(false);
    expect(automationMatchesEvent(automation(), { ...bugEvent, workItem: { ...bugEvent.workItem!, type: "STORY" } })).toBe(false);
    expect(automationMatchesEvent(automation(), { ...bugEvent, kind: "work_item_status" })).toBe(false);
    expect(automationMatchesEvent(automation({ projectId: "other" }), bugEvent)).toBe(false);
    expect(automationMatchesEvent(automation({ projectId: "p1" }), bugEvent)).toBe(true);
  });

  it("orders steps trigger → agent → test → deploy and compiles a tool-accurate prompt", () => {
    const flow = automation().flow!;
    const kinds = orderedSteps(flow)
      .map((step) => step.node.kind)
      .filter((kind) => kind !== "supervisor");
    expect(kinds.slice(0, 3)).toEqual(["agent", "test", "deploy"]);

    const prompt = compileAutomationPrompt(automation(), bugEvent);
    expect(prompt).toContain("WEB-12");
    expect(prompt).toContain("Login button crashes");
    expect(prompt).toContain("coding_session_exec");
    expect(prompt).toContain("github_open_pr");
    expect(prompt).toContain("notify_channel");
    expect(prompt).toContain("fairlx_work_item_update");
    expect(prompt).toMatch(/SUPERVISOR/);
    expect(prompt).not.toMatch(/\{\{key\}\}/);
  });

  it("keeps compacted flows inside the harness automations budget", () => {
    const flow = compactFlow(automation().flow!);
    expect(JSON.stringify(flow).length).toBeLessThan(4000);
    expect(flow.nodes.every((node) => Number.isInteger(node.x) && Number.isInteger(node.y))).toBe(true);
  });
});
