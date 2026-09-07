import type { AgentRun, AgentRunStatus, AgentToolEvent, AgentToolEventType } from "../types";

export type AgentFaceMood = "idle" | "lookDown" | "thinking" | "coding" | "happy" | "ask" | "error" | "listening";

const CODING_EVENT_TYPES = new Set<AgentToolEventType>([
  "code_inspect",
  "terminal",
  "git_status",
  "git_stage",
  "git_unstage",
  "git_commit_plan",
  "github_write_file",
  "github_open_pr",
  "github_merge_pr",
  "coding_session_start",
  "coding_session_exec",
  "coding_session_status",
]);

const CODING_TITLE = /\b(builder|coder|git|sandbox|pull request|commit|patch)\b/i;

export const AGENT_FACE_LABEL: Record<AgentFaceMood, string> = {
  idle: "Personal Agent, idle",
  lookDown: "Personal Agent, watching you type",
  thinking: "Personal Agent, thinking",
  coding: "Personal Agent, writing code",
  happy: "Personal Agent, done",
  ask: "Personal Agent, waiting for you",
  error: "Personal Agent, needs attention",
  listening: "Personal Agent, listening",
};

function recentEvents(events: AgentToolEvent[] | undefined, windowMs = 14_000): AgentToolEvent[] {
  if (!events?.length) return [];
  const newest = events[events.length - 1];
  const origin = Date.parse(newest.createdAt || "") || 0;
  if (!origin) return events.slice(-8);
  return events.filter((event) => {
    const at = Date.parse(event.createdAt || "") || 0;
    return !at || origin - at <= windowMs;
  });
}

export function isCodingFaceActivity(events: AgentToolEvent[] | undefined, kind?: AgentRun["kind"]): boolean {
  if (kind === "coding_session") return true;
  return recentEvents(events).some(
    (event) =>
      CODING_EVENT_TYPES.has(event.type) ||
      (event.type === "delegate_agent" && CODING_TITLE.test(`${event.title} ${event.detail || ""}`)) ||
      (event.type === "subagent_progress" && CODING_TITLE.test(`${event.title} ${event.detail || ""}`)),
  );
}

export function resolveAgentFaceMood(input: {
  status?: AgentRunStatus;
  kind?: AgentRun["kind"];
  events?: AgentToolEvent[];
  typing?: boolean;
  celebrating?: boolean;
  awaitingYou?: boolean;
  listening?: boolean;
}): AgentFaceMood {
  const status = input.status;
  if (status === "failed") return "error";
  if (status === "running") {
    return isCodingFaceActivity(input.events, input.kind) ? "coding" : "thinking";
  }
  if (input.listening) return "listening";
  if (input.typing) return "lookDown";
  if (status === "awaiting_question" || status === "awaiting_confirmation" || input.awaitingYou) return "ask";
  if (input.celebrating) return "happy";
  return "idle";
}
