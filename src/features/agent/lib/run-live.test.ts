import { describe, expect, it } from "vitest";

import type { AgentToolEvent, CodingSession } from "../types";
import { deriveChangedFiles, deriveRunningTools, deriveTerminals, latestModelRoute } from "./run-live";

const T0 = Date.parse("2026-09-10T10:00:00Z");
const iso = (offset: number) => new Date(T0 + offset).toISOString();

function ev(partial: Partial<AgentToolEvent> & { type: AgentToolEvent["type"]; title: string }, offset = 0): AgentToolEvent {
  return { id: `${partial.type}-${offset}`, runId: "r1", createdAt: iso(offset), ...partial };
}

describe("run-live", () => {
  it("pairs tool_start with results by toolCallId", () => {
    const events: AgentToolEvent[] = [
      ev({ type: "tool_start", title: "Running 2 tools", payload: { calls: [{ id: "a", name: "terminal", summary: "npm test" }, { id: "b", name: "web_search", summary: "vite" }] } }, 0),
      ev({ type: "web_search", title: "vite", toolCallId: "b" }, 1000),
    ];
    const running = deriveRunningTools(events, "running");
    expect(running.map((item) => item.id)).toEqual(["a"]);
    expect(deriveRunningTools(events, "completed")).toEqual([]);
  });

  it("puts the running terminal first and the dev server in the running group", () => {
    const events: AgentToolEvent[] = [
      ev({ type: "coding_session_exec", title: "pnpm install", toolCallId: "x", payload: { command: "pnpm install", stdout: "done", exitCode: 0 } }, 0),
      ev({ type: "terminal", title: "pnpm lint", toolCallId: "y", payload: { command: "pnpm lint", stdout: "", stderr: "3 errors", exitCode: 1 } }, 2000),
      ev({ type: "tool_start", title: "Running terminal", payload: { calls: [{ id: "z", name: "terminal", summary: "pnpm test" }] } }, 3000),
    ];
    const session = {
      sandboxId: "sb",
      status: "running",
      previewLive: true,
      meta: { startCommand: "pnpm dev" },
      events: [{ id: "d", type: "dev_server", detail: "healthy on :3000", payload: { startCommand: "pnpm dev" }, createdAt: iso(1000) }],
    } as unknown as CodingSession;
    const { running, closed } = deriveTerminals(events, session, "running");
    expect(running.map((item) => item.command)).toEqual(["pnpm test", "pnpm dev"]);
    expect(running[1]?.kind).toBe("dev_server");
    expect(closed.map((item) => [item.command, item.status])).toEqual([
      ["pnpm lint", "failed"],
      ["pnpm install", "ok"],
    ]);
  });

  it("closes the fake running dev-server terminal when preview never went live", () => {
    const session = {
      sandboxId: "sb",
      status: "running",
      previewLive: false,
      meta: { startCommand: "pnpm dev" },
      events: [{ id: "d", type: "dev_server", detail: "Dev server start recorded", payload: { startCommand: "pnpm dev" }, createdAt: iso(1000) }],
    } as unknown as CodingSession;
    const { running, closed } = deriveTerminals([], session, "completed");
    expect(running).toEqual([]);
    expect(closed[0]?.kind).toBe("dev_server");
    expect(closed[0]?.status).toBe("failed");
  });

  it("merges diff files with edit events", () => {
    const events: AgentToolEvent[] = [
      ev({ type: "github_write_file", title: "wrote", payload: { path: "src/app.ts" } }, 5000),
      ev({ type: "github_write_file", title: "wrote", payload: { path: "README.md" } }, 6000),
    ];
    const files = deriveChangedFiles(events, [{ filename: "src/app.ts", status: "modified", additions: 3, deletions: 1 }]);
    expect(files.map((file) => file.path)).toEqual(["README.md", "src/app.ts"]);
    expect(files[1]?.editedAt).toBe(iso(5000));
    expect(files[1]?.additions).toBe(3);
  });

  it("reads the newest model route", () => {
    const events: AgentToolEvent[] = [
      ev({ type: "model_route", title: "a", payload: { modelId: "deepseek-flash", displayName: "Flash", task: "inspect", role: "orchestrator", pinned: false, reason: "", score: 1 } }, 0),
      ev({ type: "model_route", title: "b", payload: { modelId: "gpt-5.6-sol", displayName: "Sol", task: "coding", role: "builder", pinned: true, reason: "", score: 1 } }, 1),
    ];
    expect(latestModelRoute(events)?.modelId).toBe("gpt-5.6-sol");
  });
});
