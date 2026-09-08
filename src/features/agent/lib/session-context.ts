import type { AgentContextChip, AgentSessionMode } from "../types";
import { formatAttachedFiles, stripAttachedFiles } from "./attachments";

export const AGENT_SESSION_MODE_IDS = [
  "agent",
  "personal",
  "plan",
  "debug",
  "ask",
  "multitask",
] as const satisfies readonly AgentSessionMode[];

export const AGENT_SESSION_MODES: Array<{
  id: AgentSessionMode;
  label: string;
  icon: string;
  hint: string;
}> = [
  {
    id: "agent",
    label: "Agent",
    icon: "fa-solid fa-robot",
    hint: "Inspect, plan, then act with tools.",
  },
  {
    id: "personal",
    label: "Personal Agent",
    icon: "fa-solid fa-user-tie",
    hint: "Your Personal Agent. Orchestrate planner, builder, QA, and reviewer sub-agents.",
  },
  {
    id: "plan",
    label: "Plan",
    icon: "fa-solid fa-sliders",
    hint: "Investigate and write a plan. Do not edit yet.",
  },
  {
    id: "debug",
    label: "Debug",
    icon: "fa-solid fa-bug",
    hint: "Find the failure and propose a fix.",
  },
  {
    id: "ask",
    label: "Ask",
    icon: "fa-regular fa-comment-dots",
    hint: "Answer from context. Tools stay off unless you switch mode.",
  },
];

export const SESSION_MODE_INSTRUCTIONS: Record<AgentSessionMode, string> = {
  agent: "Stay in Agent mode. You are the Fairlx Agent, a general workspace operator — not the user's trained Personal Agent or Chief of Staff. You can still inspect, plan, code, review, and delegate to planner, builder, QA, and reviewer specialists. Do not introduce yourself as their Personal Agent, do not speak in their trained voice, and do not stand in for them on comments or assignments.",
  personal:
    "Stay in Personal Agent mode. You are the user's Chief of Staff. Decompose the goal, delegate to planner, builder, QA/tester, git, or reviewer specialists, then verify and synthesize. Do specialist work yourself only when a sub-agent would add latency without leverage. When you need a decision, call ask_user with 3 short option labels. The chat always adds Type your own as the last option.",
  plan: "Stay in Plan mode. Inspect and produce a concrete implementation plan. Do not claim you edited files or committed git.",
  debug: "Stay in Debug mode. Reproduce the failure from attached work items, logs, and code paths. Identify root cause, then a focused fix.",
  multitask: "Stay in Personal Agent mode. Delegate to planner, researcher, builder, git, or reviewer specialists when the work spans roles, then synthesize.",
  ask: "Stay in Ask mode. Answer from attached context and Fairlx data. Do not call tools unless the user explicitly asks you to take an action.",
};

export function isAgentSessionMode(value: unknown): value is AgentSessionMode {
  return AGENT_SESSION_MODE_IDS.includes(value as AgentSessionMode);
}

export function isPersonalSessionMode(session?: AgentSessionMode): boolean {
  return session === "personal" || session === "multitask";
}

export function runModeForSession(session: AgentSessionMode): "agent" | "manual" {
  return session === "ask" ? "manual" : "agent";
}

export function composeUserPrompt(text: string, chips: AgentContextChip[], sessionMode: AgentSessionMode) {
  const parts: string[] = [];
  if (sessionMode !== "agent") {
    const modeLabel = isPersonalSessionMode(sessionMode) ? "personal" : sessionMode;
    parts.push(`[Session mode: ${modeLabel}] ${SESSION_MODE_INSTRUCTIONS[sessionMode]}`);
  }
  if (chips.length) {
    parts.push("[Attached context]");
    for (const chip of chips) {
      parts.push(`- ${chip.kind}: ${chip.label}${chip.meta ? ` (${chip.meta})` : ""} [${chip.id}]`);
    }
  }
  const files = chips
    .filter((chip) => chip.content?.trim())
    .map((chip) => ({ name: chip.label, body: chip.content!.trim() }));
  if (files.length) parts.push(formatAttachedFiles(files));
  parts.push(text.trim());
  return parts.filter(Boolean).join("\n");
}

export const TRAIN_PERSONAL_MARKER = "[Train personal agent]";

export function isTrainingKickoffContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return trimmed === TRAIN_PERSONAL_MARKER || trimmed.startsWith(TRAIN_PERSONAL_MARKER);
}

export const TRAINING_SAVE_MIN_REPLIES = 6;

export function countTrainingUserReplies(messages: Array<{ role: string; content: string }>): number {
  return messages.filter((message) => message.role === "user" && !isTrainingKickoffContent(message.content)).length;
}

export function trainingSaveReady(messages: Array<{ role: string; content: string }>): boolean {
  return countTrainingUserReplies(messages) >= TRAINING_SAVE_MIN_REPLIES;
}

export function displayUserContent(content: string) {
  const stripped = stripAttachedFiles(content);
  const lines = stripped.split("\n");
  let i = 0;
  if (lines[0]?.startsWith(TRAIN_PERSONAL_MARKER)) {
    const remainder = lines[0].slice(TRAIN_PERSONAL_MARKER.length).trim();
    if (remainder) {
      lines[0] = remainder;
    } else {
      i = 1;
    }
  }
  if (lines[i]?.startsWith("[Session mode")) i += 1;
  if (lines[i]?.startsWith("[Attached context]")) {
    i += 1;
    while (i < lines.length && lines[i]?.startsWith("- ")) i += 1;
  }
  return lines.slice(i).join("\n").trim() || stripped || content;
}

export function chipKey(chip: AgentContextChip) {
  return `${chip.kind}:${chip.id}`;
}
