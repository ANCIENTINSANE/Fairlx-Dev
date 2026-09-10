import type { AgentRun, AgentToolEvent, CodingSession } from "../types";
import type { RouteDecision } from "./fairlx-router";
import { looksLikeLlmUsageEvent } from "./run-usage";

/**
 * Derive "what is happening right now" from the run's event log. Pure and client-safe; the
 * workflow sidebar, the floating status strip and the terminal tab all read from here.
 */

export type ToolStartCall = { id: string; name: string; summary: string };

const TERMINAL_TOOLS = new Set(["terminal", "coding_session_exec"]);
const LIVE_RUN_STATUSES = new Set<AgentRun["status"]>(["running"]);

export type RunningTool = ToolStartCall & { startedAt: string; eventId: string };

function toolStartCalls(event: AgentToolEvent): ToolStartCall[] {
  if (event.type !== "tool_start") return [];
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as { calls?: unknown }) : {};
  if (!Array.isArray(payload.calls)) return [];
  return payload.calls
    .filter((item): item is ToolStartCall => Boolean(item && typeof item === "object" && typeof (item as ToolStartCall).id === "string"))
    .map((item) => ({ id: item.id, name: String(item.name || ""), summary: String(item.summary || "") }));
}

/** Tool calls announced by `tool_start` that have not produced a result event yet. */
export function deriveRunningTools(events: AgentToolEvent[], runStatus?: AgentRun["status"]): RunningTool[] {
  if (!runStatus || !LIVE_RUN_STATUSES.has(runStatus)) return [];
  const finished = new Set(events.map((event) => event.toolCallId).filter((id): id is string => Boolean(id)));
  const running: RunningTool[] = [];
  for (const event of events) {
    for (const call of toolStartCalls(event)) {
      if (!finished.has(call.id)) running.push({ ...call, startedAt: event.createdAt, eventId: event.id });
    }
  }
  return running;
}

export type TerminalEntry = {
  id: string;
  kind: "exec" | "dev_server";
  command: string;
  cwd?: string;
  output: string;
  stderr?: string;
  exitCode?: number;
  status: "running" | "ok" | "failed" | "recorded";
  startedAt: string;
  endedAt?: string;
  specialist?: string;
};

type ExecPayload = {
  command?: string;
  cwd?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  status?: string;
  note?: string;
};

function execPayload(event: AgentToolEvent): ExecPayload {
  return event.payload && typeof event.payload === "object" ? (event.payload as ExecPayload) : {};
}

export function deriveTerminals(
  events: AgentToolEvent[],
  session: Pick<CodingSession, "events" | "meta" | "sandboxId" | "status" | "previewLive"> | null | undefined,
  runStatus?: AgentRun["status"],
): { running: TerminalEntry[]; closed: TerminalEntry[] } {
  const running: TerminalEntry[] = [];
  const closed: TerminalEntry[] = [];

  for (const event of events) {
    if (!TERMINAL_TOOLS.has(event.type)) continue;
    const payload = execPayload(event);
    const specialistPayload = event.payload && typeof event.payload === "object" ? (event.payload as { specialist?: string }) : {};
    const status: TerminalEntry["status"] =
      payload.status === "recorded" || payload.note
        ? "recorded"
        : typeof payload.exitCode === "number"
          ? payload.exitCode === 0
            ? "ok"
            : "failed"
          : payload.status === "failed"
            ? "failed"
            : "ok";
    closed.push({
      id: event.id,
      kind: "exec",
      command: payload.command || event.title,
      cwd: payload.cwd,
      output: payload.stdout || event.detail || "",
      stderr: payload.stderr,
      exitCode: payload.exitCode,
      status,
      startedAt: event.createdAt,
      endedAt: event.createdAt,
      specialist: specialistPayload.specialist,
    });
  }

  for (const tool of deriveRunningTools(events, runStatus)) {
    if (!TERMINAL_TOOLS.has(tool.name)) continue;
    running.push({
      id: `running:${tool.id}`,
      kind: "exec",
      command: tool.summary || tool.name,
      output: "",
      status: "running",
      startedAt: tool.startedAt,
    });
  }

  // The dev server is a long-running terminal for as long as the sandbox is up.
  const devServer = [...(session?.events ?? [])].reverse().find((event) => event.type === "dev_server");
  if (devServer && session?.sandboxId && session.meta?.lifecycle !== "destroyed") {
    const payload = devServer.payload && typeof devServer.payload === "object" ? (devServer.payload as { startCommand?: string }) : {};
    const command = payload.startCommand || session.meta?.startCommand || "dev server";
    const paused = session.meta?.lifecycle === "paused";
    const unhealthy = session.previewLive !== true && session.status !== "queued" && session.status !== "preparing";
    const entry: TerminalEntry = {
      id: `dev-server:${devServer.id}`,
      kind: "dev_server",
      command,
      cwd: "/workspace",
      output: devServer.detail || "",
      status: paused || unhealthy ? (unhealthy ? "failed" : "ok") : "running",
      startedAt: devServer.createdAt,
      endedAt: paused ? session.meta?.pausedAt : unhealthy ? devServer.createdAt : undefined,
    };
    (paused || unhealthy ? closed : running).push(entry);
  }

  const byNewest = (a: TerminalEntry, b: TerminalEntry) => b.startedAt.localeCompare(a.startedAt);
  running.sort(byNewest);
  closed.sort(byNewest);
  return { running, closed };
}

export type ChangedFile = {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  /** ISO time of the most recent edit event we saw for this file (drives the "just edited" animation). */
  editedAt?: string;
};

type DiffFileLike = {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  previous_filename?: string;
};

const FILE_EVENT_TYPES = new Set(["github_write_file", "github_delete_file", "git_stage", "coding_session_implement"]);

export function deriveChangedFiles(events: AgentToolEvent[], diffFiles: DiffFileLike[]): ChangedFile[] {
  const map = new Map<string, ChangedFile>();
  for (const file of diffFiles) {
    const status: ChangedFile["status"] =
      file.status === "added" ? "added" : file.status === "removed" ? "removed" : file.status === "renamed" ? "renamed" : "modified";
    map.set(file.filename, {
      path: file.filename,
      status,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
    });
  }
  for (const event of events) {
    if (!FILE_EVENT_TYPES.has(event.type)) continue;
    const payload = event.payload && typeof event.payload === "object" ? (event.payload as { path?: string; paths?: string[]; files?: Array<{ path?: string; filename?: string }> }) : {};
    const paths: string[] = [];
    if (typeof payload.path === "string") paths.push(payload.path);
    if (Array.isArray(payload.paths)) paths.push(...payload.paths.filter((item): item is string => typeof item === "string"));
    if (Array.isArray(payload.files)) {
      for (const file of payload.files) {
        const path = file?.path || file?.filename;
        if (typeof path === "string") paths.push(path);
      }
    }
    for (const path of paths) {
      const existing = map.get(path);
      if (existing) {
        if (!existing.editedAt || existing.editedAt < event.createdAt) existing.editedAt = event.createdAt;
      } else {
        map.set(path, {
          path,
          status: event.type === "github_delete_file" ? "removed" : "modified",
          additions: 0,
          deletions: 0,
          editedAt: event.createdAt,
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function latestModelRoute(events: AgentToolEvent[]): RouteDecision | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type !== "model_route") continue;
    if (event.payload && typeof event.payload === "object" && "modelId" in event.payload) return event.payload as RouteDecision;
  }
  return null;
}

/** Newest thought-like line — what the model is "thinking" right now. */
export function latestThought(events: AgentToolEvent[]): AgentToolEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (looksLikeLlmUsageEvent(event)) continue;
    if (event.type === "thought" || event.type === "subagent_progress" || event.type === "tool_start" || event.type === "job_progress") return event;
  }
  return null;
}

export function summarizeRunLive(
  run: Pick<AgentRun, "status" | "events">,
  session: Pick<CodingSession, "events" | "meta" | "sandboxId" | "status" | "previewLive"> | null | undefined,
  diffFiles: DiffFileLike[],
) {
  const events = run.events ?? [];
  const runningTools = deriveRunningTools(events, run.status);
  const terminals = deriveTerminals(events, session, run.status);
  const files = deriveChangedFiles(events, diffFiles);
  return {
    runningTools,
    terminals,
    files,
    route: latestModelRoute(events),
    thought: latestThought(events),
  };
}
