import type { AgentContextChip, AgentSessionMode } from "../types";
import { formatAttachedImages, imageMimeFromDataUrl, stripAttachedImages } from "./attach-images";
import { formatAttachedFiles, stripAttachedFiles } from "./attachments";
import { expandComposerShortcuts, stripComposerShortcuts, type ComposerShortcut } from "./composer-shortcuts";
import { detectSessionMode, type ModeDecision, type ResolvedSessionMode } from "./mode-router";
import { attachPageContext, stripPageContext } from "./page-context";

export const AGENT_SESSION_MODE_IDS = [
  "auto",
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
    id: "auto",
    label: "Auto",
    icon: "fa-solid fa-wand-magic-sparkles",
    hint: "Fairlx reads your message and picks Plan, Debug, Ask, Personal or Agent for you.",
  },
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

/** Applies to every mode: predict the obvious, don't interrogate. */
export const NO_INTERROGATION_INSTRUCTION =
  "Be ready before the user asks: when a request is under-specified (project type, name, stack), infer sensible defaults from the words used, state them as assumptions in one line, and move on. Never open with a list of questions. Ask at most one decision via ask_user, and only when the answer changes the work materially.";

export const SESSION_MODE_INSTRUCTIONS: Record<AgentSessionMode, string> = {
  auto: "Auto mode: follow the [Session mode: …] tag at the top of the latest user message; it names the mode Fairlx picked for this turn. If no tag is present, behave as Agent mode.",
  agent: "Stay in Agent mode. You are the Fairlx Agent, a general workspace operator — not the user's trained Personal Agent or Chief of Staff. You can still inspect, plan, code, review, and delegate to planner, builder, QA, and reviewer specialists. Do not introduce yourself as their Personal Agent, do not speak in their trained voice, and do not stand in for them on comments or assignments.",
  personal:
    "Stay in Personal Agent mode. You are the user's Chief of Staff. Decompose the goal, delegate to planner, builder, QA/tester, git, or reviewer specialists, then verify and synthesize. Do specialist work yourself only when a sub-agent would add latency without leverage. When you need a decision, call ask_user with 3 short option labels. The chat always adds Type your own as the last option.",
  plan: "Stay in Plan mode. Inspect and produce a concrete implementation plan via submit_implementation_plan with phases and tasks. If nothing is connected yet (no project, no repo), still write the full plan: propose the project name, stack, and first milestone yourself, and list what you will need (GitHub repo, sandbox) as plan steps rather than questions. Do not claim you edited files or committed git.",
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

export function isAutoSessionMode(session?: AgentSessionMode): boolean {
  return session === "auto";
}

export function runModeForSession(session: AgentSessionMode): "agent" | "manual" {
  return session === "ask" ? "manual" : "agent";
}

/**
 * Resolve the mode a turn should run in. In `auto` the mode router reads the text; otherwise
 * the pinned mode wins. Returns the decision so the UI can show what was picked and why.
 */
export function resolveTurnMode(
  text: string,
  sessionMode: AgentSessionMode,
  options?: { hasProject?: boolean; hasRepo?: boolean },
): ModeDecision & { auto: boolean } {
  if (isAutoSessionMode(sessionMode)) {
    return { ...detectSessionMode(text, options), auto: true };
  }
  const mode: ResolvedSessionMode = isPersonalSessionMode(sessionMode)
    ? "personal"
    : (sessionMode as ResolvedSessionMode);
  return { mode, confidence: 1, reason: "pinned by user", hints: [], auto: false };
}

export function composeUserPrompt(
  text: string,
  chips: AgentContextChip[],
  sessionMode: AgentSessionMode,
  pageContext?: string | null,
  options?: { hasProject?: boolean; hasRepo?: boolean; extraAt?: ComposerShortcut[] },
) {
  const expanded = expandComposerShortcuts(text, options?.extraAt);
  const mergedChips = [...chips];
  for (const chip of expanded.chips) {
    if (!mergedChips.some((item) => chipKey(item) === chipKey(chip))) mergedChips.push(chip);
  }
  const parts: string[] = [];
  if (expanded.mode) {
    parts.push(
      `[Session mode: ${expanded.mode}] ${SESSION_MODE_INSTRUCTIONS[expanded.mode]} ${NO_INTERROGATION_INSTRUCTION}`,
    );
  } else {
    const decision = resolveTurnMode(text, sessionMode, options);
    if (decision.auto) {
      const hints = decision.hints.length ? ` Hints: ${decision.hints.join(" ")}` : "";
      parts.push(
        `[Session mode: ${decision.mode} · auto] ${SESSION_MODE_INSTRUCTIONS[decision.mode]} ${NO_INTERROGATION_INSTRUCTION}${hints}`,
      );
    } else if (sessionMode !== "agent") {
      parts.push(`[Session mode: ${decision.mode}] ${SESSION_MODE_INSTRUCTIONS[sessionMode]} ${NO_INTERROGATION_INSTRUCTION}`);
    }
  }
  if (mergedChips.length) {
    parts.push("[Attached context]");
    for (const chip of mergedChips) {
      parts.push(`- ${chip.kind}: ${chip.label}${chip.meta ? ` (${chip.meta})` : ""} [${chip.id}]`);
    }
  }
  const files = mergedChips
    .filter((chip) => chip.kind !== "image" && chip.content?.trim())
    .map((chip) => ({ name: chip.label, body: chip.content!.trim() }));
  if (files.length) parts.push(formatAttachedFiles(files));
  const images = mergedChips
    .filter((chip) => chip.kind === "image" && chip.content?.startsWith("data:image/"))
    .map((chip) => ({
      name: chip.label,
      mime: imageMimeFromDataUrl(chip.content!),
      dataUrl: chip.content!.trim(),
    }));
  if (images.length) parts.push(formatAttachedImages(images));
  parts.push(expanded.text.trim());
  return attachPageContext(parts.filter(Boolean).join("\n"), pageContext);
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
  const stripped = stripAttachedImages(stripPageContext(stripAttachedFiles(content)));
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
  while (lines[i]?.startsWith("[Shortcut ")) i += 1;
  const shown = stripComposerShortcuts(lines.slice(i).join("\n")).trim();
  if (shown) return shown;
  if (isTrainingKickoffContent(content)) return TRAIN_PERSONAL_MARKER;
  return "";
}

export function chipKey(chip: AgentContextChip) {
  return `${chip.kind}:${chip.id}`;
}
