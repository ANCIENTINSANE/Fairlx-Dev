import { kindsFromToolName, type FairlxSyncKind } from "@/lib/fairlx-query-sync";
import { unwrapMcpToolContent } from "./truncate";

import type { AgentChatMessage, AgentRun, AgentToolEvent } from "../types";

export type AgentMutationSnapshot = {
  fingerprint: string;
  kinds: FairlxSyncKind[];
};

function parseJsonObject(raw?: string): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(unwrapMcpToolContent(raw));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isFailedToolContent(content?: string): boolean {
  if (!content?.trim()) return false;
  const record = asRecord(content);
  if (record && typeof record.error === "string" && record.error.trim()) return true;
  return false;
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toolNamesFromMessage(message: AgentChatMessage): string[] {
  const name = (message.toolName || "").trim();
  if (name !== "mcp_call") return name ? [name] : [];
  const envelope = parseJsonObject(message.content);
  const fromEnvelope = String(envelope?.tool || envelope?.name || "").trim();
  if (fromEnvelope) return [fromEnvelope];
  const parsed = message.content ? asRecord(message.content) : null;
  const inner = String(parsed?.tool || parsed?.name || "").trim();
  return inner ? [inner] : [];
}

function toolNameFromEvent(event: AgentToolEvent): string {
  if (event.type === "create_project") return "create_project";
  if (event.type === "github_write_file" || event.type === "github_open_pr") return event.type;
  if (event.type !== "mcp_call") return event.type;
  const payload = nestedRecord(event.payload);
  return String(payload?.tool || payload?.name || "").trim();
}

export function kindsFromAgentMessages(messages: AgentChatMessage[]): {
  fingerprint: string;
  kinds: FairlxSyncKind[];
} {
  const kinds = new Set<FairlxSyncKind>();
  const ids: string[] = [];

  for (const message of messages) {
    if (message.role !== "tool") continue;
    if (isFailedToolContent(message.content)) continue;
    const names = toolNamesFromMessage(message);
    const matched: FairlxSyncKind[] = [];
    for (const name of names) matched.push(...kindsFromToolName(name));
    if (!matched.length) continue;
    ids.push(message.id || message.toolCallId || names.join(","));
    for (const kind of matched) kinds.add(kind);
  }

  return { fingerprint: ids.join("|"), kinds: [...kinds] };
}

export function kindsFromAgentEvents(events: AgentToolEvent[]): FairlxSyncKind[] {
  const kinds = new Set<FairlxSyncKind>();
  for (const event of events) {
    if (event.type === "error") continue;
    const name = toolNameFromEvent(event);
    for (const kind of kindsFromToolName(name)) kinds.add(kind);
  }
  return [...kinds];
}

export function agentMutationSnapshot(
  run?: Pick<AgentRun, "messages" | "events"> | null,
): AgentMutationSnapshot {
  if (!run) return { fingerprint: "", kinds: [] };
  const fromMessages = kindsFromAgentMessages(run.messages ?? []);
  const fromEvents = kindsFromAgentEvents(run.events ?? []);
  const kinds = new Set<FairlxSyncKind>([...fromMessages.kinds, ...fromEvents]);
  const eventFingerprint = (run.events ?? [])
    .filter((event) => event.type !== "error" && kindsFromToolName(toolNameFromEvent(event)).length > 0)
    .map((event) => event.id)
    .join("|");
  return {
    fingerprint: [fromMessages.fingerprint, eventFingerprint].filter(Boolean).join("::"),
    kinds: [...kinds],
  };
}
