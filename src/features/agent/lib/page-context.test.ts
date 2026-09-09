import { describe, expect, it } from "vitest";

import { composeUserPrompt, displayUserContent } from "./session-context";
import {
  attachPageContext,
  defaultPageSnapshot,
  formatPageContextBlock,
  formatPageSnapshot,
  keepLatestPageContext,
  labelDashboardPage,
  PAGE_CONTEXT_MAX_CHARS,
  stripPageContext,
} from "./page-context";

describe("labelDashboardPage", () => {
  it("labels project timeline and kanban from the task-view query", () => {
    expect(labelDashboardPage("/workspaces/ws1/projects/p1", "?task-view=timeline")).toBe("Project timeline");
    expect(labelDashboardPage("/workspaces/ws1/projects/p1", "?task-view=kanban")).toBe("Project kanban");
    expect(labelDashboardPage("/workspaces/ws1")).toBe("Home");
    expect(labelDashboardPage("/acme/workspaces/ws1/timeline")).toBe("Timeline");
    expect(labelDashboardPage("/workspaces/ws1/tasks", "?task-view=kanban")).toBe("My Spaces · Kanban");
  });
});

describe("page snapshot format", () => {
  it("formats layout and entities then strips them from displayed chat", () => {
    const snapshot = defaultPageSnapshot({
      pathname: "/workspaces/ws1/projects/p1",
      search: "?task-view=timeline",
      workspaceId: "ws1",
      projectId: "p1",
      heading: "Agent Harness Landing Page",
    });
    snapshot.entities = [
      {
        kind: "work_item",
        id: "id7",
        key: "AGEN-7",
        title: "Responsive header",
        status: "TODO",
        location: "Sprint 1 / AGEN-1",
        extra: "bar 2026-09-11–2026-09-18",
      },
    ];
    snapshot.layout = [
      { id: "tree", position: "main-left", label: "Sprint tree", summary: "Sprint 1 expanded" },
      { id: "grid", position: "main-right", label: "Gantt", summary: "Weeks" },
    ];
    const body = formatPageSnapshot(snapshot);
    expect(body).toContain("Page: Project timeline");
    expect(body).toContain("main-left: Sprint tree");
    expect(body).toContain("AGEN-7");
    expect(body).toContain("Sprint 1 / AGEN-1");

    const block = formatPageContextBlock(snapshot);
    const prompt = composeUserPrompt("Move AGEN-7 one week", [], "agent", block);
    expect(prompt).toContain("[Current page]");
    expect(prompt).toContain("Move AGEN-7 one week");
    expect(displayUserContent(prompt)).toBe("Move AGEN-7 one week");
    expect(stripPageContext(prompt)).toBe("Move AGEN-7 one week");
  });

  it("caps snapshot size", () => {
    const snapshot = defaultPageSnapshot({ pathname: "/workspaces/ws1" });
    snapshot.entities = Array.from({ length: 80 }, (_, index) => ({
      kind: "work_item",
      id: `id-${index}`,
      key: `AGEN-${index}`,
      title: `Task ${index} with a fairly long title for the snapshot`,
      status: "TODO",
      location: "Sprint 1 / epic",
    }));
    const body = formatPageSnapshot(snapshot);
    expect(body.length).toBeLessThanOrEqual(PAGE_CONTEXT_MAX_CHARS);
    expect(body).toContain("more items omitted");
  });

  it("keeps only the latest page block on older user messages", () => {
    const first = attachPageContext("Hello", formatPageContextBlock(defaultPageSnapshot({ pathname: "/workspaces/a" })));
    const second = attachPageContext(
      "Now this",
      formatPageContextBlock(defaultPageSnapshot({ pathname: "/workspaces/b/timeline" })),
    );
    const next = keepLatestPageContext([
      { role: "user", content: first },
      { role: "assistant", content: "ok" },
      { role: "user", content: second },
    ]);
    expect(next[0]?.content).toBe("Hello");
    expect(next[2]?.content).toContain("[Current page]");
    expect(next[2]?.content).toContain("Now this");
  });
});
