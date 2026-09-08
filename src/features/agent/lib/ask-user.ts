import type { AgentChatMessage, AgentToolCall, AgentToolEvent } from "../types";
import { unmatchedToolCalls } from "./write-guard";

export type PendingAskUser = {
  question: string;
  options: string[];
  allowCustom: boolean;
  toolCallId: string;
};

const MAX_OPTIONS = 3;
const MAX_LABEL = 160;
const RESERVED_CUSTOM_RE =
  /^(other|custom|type your own|type your own[.…]*|something else|none of (these|the above)|write my own|i('ll| will) type.+)$/i;

export const ASK_USER_CUSTOM_VALUE = "__fairlx_custom__";

export function isReservedCustomChoice(label: string): boolean {
  return RESERVED_CUSTOM_RE.test(label.trim());
}

export function splitChoiceLabel(label: string): { title: string; description?: string } {
  const trimmed = label.trim();
  const parts = trimmed.split(/\s+(?:—|–|-)\s+/);
  if (parts.length >= 2) {
    const title = parts[0]!.trim();
    const description = parts.slice(1).join(" — ").trim();
    if (title && description) return { title, description };
  }
  return { title: trimmed };
}

function labelFromRawOption(item: unknown): string {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";
  const rec = item as { label?: unknown; title?: unknown; description?: unknown };
  const title =
    typeof rec.label === "string"
      ? rec.label.trim()
      : typeof rec.title === "string"
        ? rec.title.trim()
        : "";
  if (!title) return "";
  const description = typeof rec.description === "string" ? rec.description.trim() : "";
  return description ? `${title} — ${description}` : title;
}

export function normalizeAskUserOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const options: string[] = [];
  for (const item of raw) {
    const label = labelFromRawOption(item);
    if (!label || label.length > MAX_LABEL || isReservedCustomChoice(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(label);
    if (options.length >= MAX_OPTIONS) break;
  }
  return options;
}

export function parseAskUserArgs(args: unknown): Omit<PendingAskUser, "toolCallId"> {
  let parsed: Record<string, unknown> = {};
  if (typeof args === "string") {
    try {
      const value = JSON.parse(args);
      if (value && typeof value === "object") parsed = value as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  } else if (args && typeof args === "object") {
    parsed = args as Record<string, unknown>;
  }
  const question = typeof parsed.question === "string" ? parsed.question.trim() : "";
  const allowCustom = parsed.allowCustom !== false;
  return {
    question,
    options: normalizeAskUserOptions(parsed.options),
    allowCustom,
  };
}

export function parseAskUserFromMessage(message: AgentChatMessage): PendingAskUser | null {
  const call = message.toolCalls?.find((item) => item.name === "ask_user");
  if (!call) return null;
  return { ...parseAskUserArgs(call.arguments), toolCallId: call.id };
}

export function findPendingAskUser(
  messages: AgentChatMessage[] = [],
  events: AgentToolEvent[] = [],
): PendingAskUser | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type === "ask_user_resolved") return undefined;
    if (event.type === "ask_user") {
      const fromEvent = pendingFromEvent(event);
      if (fromEvent) return fromEvent;
    }
  }
  const unmatched = unmatchedToolCalls(messages).find((call) => call.name === "ask_user");
  if (unmatched) {
    return { ...parseAskUserArgs(unmatched.arguments), toolCallId: unmatched.id };
  }
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  return lastAssistant ? parseAskUserFromMessage(lastAssistant) ?? undefined : undefined;
}

function pendingFromEvent(event: AgentToolEvent): PendingAskUser | undefined {
  const payload = event.payload;
  if (!payload || typeof payload !== "object") return undefined;
  const data = payload as Partial<PendingAskUser>;
  if (typeof data.toolCallId !== "string" || !data.toolCallId) return undefined;
  return {
    question: typeof data.question === "string" ? data.question : event.title || "",
    options: normalizeAskUserOptions(data.options),
    allowCustom: data.allowCustom !== false,
    toolCallId: data.toolCallId,
  };
}

export function askUserToolResult(call: AgentToolCall, answer: string, source: "option" | "custom" | "user") {
  return {
    id: crypto.randomUUID(),
    role: "tool" as const,
    content: JSON.stringify({ answer: answer.trim(), source }),
    toolCallId: call.id,
    toolName: "ask_user",
    createdAt: new Date().toISOString(),
  };
}

export function applyUserAnswerToPendingQuestion(
  input: { messages: AgentChatMessage[]; events: AgentToolEvent[] },
  answer: string,
): { messages: AgentChatMessage[]; events: AgentToolEvent[] } {
  const trimmed = answer.trim();
  const userMessage: AgentChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: trimmed,
    createdAt: new Date().toISOString(),
  };
  const pending = findPendingAskUser(input.messages, input.events);
  const messages = [...input.messages, userMessage];
  if (!pending) {
    return { messages, events: input.events };
  }
  const source = pending.options.some((option) => option.toLowerCase() === trimmed.toLowerCase())
    ? "option"
    : "custom";
  messages.push({
    id: crypto.randomUUID(),
    role: "tool",
    content: JSON.stringify({ answer: trimmed, source }),
    toolCallId: pending.toolCallId,
    toolName: "ask_user",
    createdAt: new Date().toISOString(),
  });
  return {
    messages,
    events: [
      ...input.events,
      {
        id: crypto.randomUUID(),
        type: "ask_user_resolved",
        title: source === "option" ? "Chose an option" : "Typed a custom answer",
        detail: trimmed.slice(0, 160),
        createdAt: new Date().toISOString(),
        runId: input.events[0]?.runId || "",
      },
    ],
  };
}
