import type { AgentChatMessage } from "../../types";
import { keepLatestImages } from "../attach-images";
import { keepLatestPageContext } from "../page-context";
import { compactJsonString, unwrapMcpToolContent } from "../truncate";

export const COMPRESS_KEEP_RECENT = 8;
export const SPECIALIST_RESULT_MAX = 24000;
/** Safety cap after prior turns are collapsed. User messages are never dropped to hit this. */
export const MODEL_HISTORY = 80;
export const CONTEXT_BUDGET_RATIO = 0.72;

function summarizeToolBody(content: string): string {
  const raw = unwrapMcpToolContent(content);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return compactJsonString(raw, 400);
    const slim: Record<string, unknown> = { compressed: true };
    for (const key of ["error", "key", "title", "status", "path", "url", "html_url", "message", "ok", "jobId", "skipped"]) {
      if (parsed[key] != null) slim[key] = parsed[key];
    }
    if (Array.isArray(parsed.items)) slim.itemCount = parsed.items.length;
    if (Array.isArray(parsed.workItems)) slim.workItemCount = parsed.workItems.length;
    if (Array.isArray(parsed.findings)) slim.findingCount = parsed.findings.length;
    if (Array.isArray(parsed.hits)) slim.hitCount = parsed.hits.length;
    if (Array.isArray(parsed.extracts)) slim.extractCount = parsed.extracts.length;
    if (typeof parsed.content === "string") slim.contentPreview = parsed.content.slice(0, 180);
    if (typeof parsed.text === "string") slim.textPreview = parsed.text.slice(0, 400);
    if (typeof parsed.extract === "string") slim.extractPreview = parsed.extract.slice(0, 400);
    return compactJsonString(JSON.stringify(slim), 700);
  } catch {
    return compactJsonString(raw, 400);
  }
}

export function compressMessages(messages: AgentChatMessage[]): AgentChatMessage[] {
  if (messages.length <= COMPRESS_KEEP_RECENT) return messages;
  const cut = messages.length - COMPRESS_KEEP_RECENT;
  return messages.map((message, index) => {
    if (index >= cut) return message;
    if (message.role !== "tool") return message;
    return { ...message, content: summarizeToolBody(message.content) };
  });
}

export function capSpecialistResult(content: string): string {
  return compactJsonString(content, SPECIALIST_RESULT_MAX);
}

function payloadChars(system: string, messages: AgentChatMessage[]): number {
  const body = messages.reduce((sum, message) => {
    const args =
      message.toolCalls?.reduce((inner, call) => inner + call.arguments.length + call.name.length, 0) ?? 0;
    return sum + (message.content?.length ?? 0) + args;
  }, 0);
  return system.length + body;
}

function shrinkToolContent(message: AgentChatMessage, cap: number): AgentChatMessage {
  if (message.role !== "tool") return message;
  return { ...message, content: compactJsonString(message.content ?? "", cap) };
}

function lastUserIndex(messages: AgentChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function toolProgressStub(tools: AgentChatMessage[]): string {
  const names = tools
    .map((message) => (message.toolName || "").replace(/^fairlx_/, ""))
    .filter(Boolean);
  if (!names.length) return "";
  const unique = [...new Set(names)].slice(0, 8);
  return `Already done in this chat: ${unique.join(", ")}. Continue from the user's latest instruction. Do not ask what they want to build.`;
}

/**
 * Keep every user message. Replace finished tool loops with a short progress
 * stub so a 40-call create burst cannot wipe the product spec.
 */
export function collapsePriorTurns(messages: AgentChatMessage[]): AgentChatMessage[] {
  const cut = lastUserIndex(messages);
  if (cut <= 0) return messages;
  const prior = messages.slice(0, cut);
  const current = messages.slice(cut);
  const collapsed: AgentChatMessage[] = [];
  let index = 0;
  while (index < prior.length) {
    const message = prior[index];
    if (!message) break;
    if (message.role === "user") {
      collapsed.push(message);
      index += 1;
      continue;
    }
    if (message.role === "assistant") {
      const text = (message.content || "").trim();
      const hasTools = Boolean(message.toolCalls?.length);
      if (!hasTools) {
        collapsed.push(message);
        index += 1;
        continue;
      }
      const toolStart = index + 1;
      index += 1;
      while (index < prior.length && prior[index]?.role === "tool") index += 1;
      const next = prior[index];
      if (text) {
        collapsed.push({ ...message, content: text, toolCalls: undefined });
        continue;
      }
      if (!next || next.role === "user") {
        const stub = toolProgressStub(prior.slice(toolStart, index));
        if (stub) {
          collapsed.push({
            id: `${message.id}-stub`,
            role: "assistant",
            content: stub,
            createdAt: message.createdAt,
          });
        }
      }
      continue;
    }
    index += 1;
  }
  return [...collapsed, ...current];
}

export function repairToolPairing(messages: AgentChatMessage[]): AgentChatMessage[] {
  const hasResult = new Set(
    messages
      .filter((message) => message.role === "tool" && message.toolCallId)
      .map((message) => message.toolCallId as string),
  );
  const keptCallIds = new Set<string>();
  const out: AgentChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "assistant" && message.toolCalls?.length) {
      const calls = message.toolCalls.filter((call) => hasResult.has(call.id));
      for (const call of calls) keptCallIds.add(call.id);
      const content = (message.content || "").trim();
      if (!calls.length && !content) continue;
      out.push({ ...message, toolCalls: calls.length ? calls : undefined });
      continue;
    }
    if (message.role === "tool") {
      if (message.toolCallId && keptCallIds.has(message.toolCallId)) out.push(message);
      continue;
    }
    out.push(message);
  }
  return out;
}

function keepUsersAndTail(messages: AgentChatMessage[], max: number): AgentChatMessage[] {
  const users = messages.filter((message) => message.role === "user");
  if (messages.length <= max) return messages;
  if (users.length >= max) {
    return repairToolPairing([users[0]!, ...users.slice(-(max - 1))].filter(Boolean));
  }
  const keepIds = new Set(users.map((message) => message.id));
  const room = max - users.length;
  const tail: AgentChatMessage[] = [];
  for (let index = messages.length - 1; index >= 0 && tail.length < room; index -= 1) {
    const message = messages[index];
    if (!message || keepIds.has(message.id)) continue;
    tail.unshift(message);
  }
  for (const message of tail) keepIds.add(message.id);
  return repairToolPairing(messages.filter((message) => keepIds.has(message.id)));
}

/**
 * Keep the prompt inside the model's input window so a research turn cannot hang
 * on a 72k+ Grok call after Wikipedia fetches — without dropping later user
 * instructions that actually describe the product.
 */
export function fitMessagesForModel(
  system: string,
  messages: AgentChatMessage[],
  maxInputTokens?: number,
  budgetRatio = CONTEXT_BUDGET_RATIO,
): AgentChatMessage[] {
  let next = keepLatestImages(keepLatestPageContext(compressMessages(collapsePriorTurns(messages))));
  next = repairToolPairing(next);
  next = keepUsersAndTail(next, MODEL_HISTORY);

  if (!maxInputTokens || maxInputTokens <= 0) return next;
  const budgetChars = Math.max(12_000, Math.floor(maxInputTokens * 4 * budgetRatio) - 4_000);
  if (payloadChars(system, next) <= budgetChars) return next;

  next = next.map((message) => shrinkToolContent(message, 2_500));
  if (payloadChars(system, next) <= budgetChars) return next;

  const toolIndexes = next.map((message, index) => (message.role === "tool" ? index : -1)).filter((index) => index >= 0);
  const keepRecent = new Set(toolIndexes.slice(-2));
  next = next.map((message, index) => {
    if (message.role !== "tool") return message;
    if (keepRecent.has(index)) return shrinkToolContent(message, 1_800);
    return { ...message, content: summarizeToolBody(message.content) };
  });
  if (payloadChars(system, next) <= budgetChars) return next;

  next = next.map((message) => (message.role === "tool" ? { ...message, content: summarizeToolBody(message.content) } : message));
  return next;
}

export function estimatedFittedTokens(
  system: string,
  messages: AgentChatMessage[],
  maxInputTokens?: number,
  budgetRatio = CONTEXT_BUDGET_RATIO,
): number {
  const chars = payloadChars(system, fitMessagesForModel(system, messages, maxInputTokens, budgetRatio));
  return Math.max(1, Math.ceil(chars / 4));
}
