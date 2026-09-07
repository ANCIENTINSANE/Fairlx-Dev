import type { AgentRun, AgentToolEvent } from "../types";
import { AGENT_SPECIALISTS } from "./graph";
import { MAX_PARALLEL_SUBAGENTS } from "./parallel-work";
import { looksLikeLlmUsageEvent, parseLlmUsagePayload } from "./run-usage";

export type AgentCrewStatus = "working" | "done" | "idle";

export type AgentCrewActivity = {
  id: string;
  at: string;
  title: string;
  detail?: string;
  kind: "thought" | "tool" | "progress" | "status";
};

export type AgentCrewInstance = {
  id: string;
  specialist: string;
  name: string;
  parent: string;
  label: string;
  task: string;
  status: "working" | "done";
  lastAction?: string;
  currentAction?: string;
  modelName: string;
  modelId?: string;
  calls: number;
  tokens: number;
  costUSD: number;
  startedAt?: string;
  finishedAt?: string;
  activity: AgentCrewActivity[];
  children: AgentCrewInstance[];
};

export type AgentCrewType = {
  specialist: string;
  name: string;
  live: number;
  total: number;
};

export type AgentCrewRosterItem = {
  specialist: string;
  name: string;
  role: string;
  live: number;
  total: number;
};

export type AgentCrewHints = {
  orchestratorModelName?: string;
  orchestratorModelId?: string;
  workerModelName?: string;
  workerModelId?: string;
};

export type AgentCrew = {
  live: number;
  total: number;
  directLive: number;
  directTotal: number;
  nestedLive: number;
  nestedTotal: number;
  parallelCap: number;
  orchestratorStatus: AgentCrewStatus;
  orchestratorModelName: string;
  orchestratorModelId?: string;
  workerModelName: string;
  workerModelId?: string;
  orchestratorAction?: string;
  orchestratorActivity: AgentCrewActivity[];
  orchestratorCalls: number;
  orchestratorTokens: number;
  types: AgentCrewType[];
  roster: AgentCrewRosterItem[];
  children: AgentCrewInstance[];
};

const ROOT_PARENTS = new Set(["", "orchestrator", "main", "parent"]);
const ACTIVITY_SKIP = new Set(["context_meter", "llm_usage", "confirmation_resolved"]);
const MAX_ACTIVITY = 6;

export function specialistDisplayName(id: string): string {
  const known = AGENT_SPECIALISTS.find((item) => item.id === id);
  if (known) return known.name;
  if (!id) return "Specialist";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export function isRootParent(parent: string): boolean {
  return ROOT_PARENTS.has(parent.trim().toLowerCase());
}

function asPayload(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function instanceLabel(params: { subject?: string; task: string; title: string }): string {
  const subject = params.subject?.trim();
  if (subject) return subject;
  const task = params.task.trim();
  if (task) return task.length > 72 ? `${task.slice(0, 71)}…` : task;
  return params.title.replace(/\s+started$/i, "").trim() || "Specialist";
}

function runIsLive(status?: AgentRun["status"]): boolean {
  return status === "running" || status === "awaiting_confirmation" || status === "awaiting_plugin";
}

function runIsTerminal(status?: AgentRun["status"]): boolean {
  return status === "completed" || status === "failed" || status === "stopped";
}

function activityKind(event: AgentToolEvent): AgentCrewActivity["kind"] {
  if (event.type === "thought") return "thought";
  if (event.type === "subagent_progress") return "progress";
  if (event.type.startsWith("subagent_")) return "status";
  return "tool";
}

function toActivity(event: AgentToolEvent): AgentCrewActivity | null {
  if (ACTIVITY_SKIP.has(event.type) || looksLikeLlmUsageEvent(event)) return null;
  return {
    id: event.id,
    at: event.createdAt,
    title: event.title,
    detail: event.detail,
    kind: activityKind(event),
  };
}

function pushActivity(list: AgentCrewActivity[], item: AgentCrewActivity | null) {
  if (!item) return;
  list.push(item);
  if (list.length > MAX_ACTIVITY) list.splice(0, list.length - MAX_ACTIVITY);
}

function usageSubagentId(event: AgentToolEvent): string {
  const payload = asPayload(event.payload);
  const tagged = asString(payload.subagentId);
  if (tagged) return tagged;
  const operationId = asString(payload.operationId);
  const marker = ":sub:";
  const index = operationId.indexOf(marker);
  if (index === -1) return "";
  const rest = operationId.slice(index + marker.length);
  const last = rest.lastIndexOf(":");
  return last > 0 ? rest.slice(0, last) : rest;
}

function eventOwnerId(
  event: AgentToolEvent,
  liveOpen: string[],
  knownIds: Set<string>,
): string | "orchestrator" {
  const payload = asPayload(event.payload);
  const tagged = asString(payload.subagentId);
  if (tagged && knownIds.has(tagged)) return tagged;
  if (event.type.startsWith("subagent_")) {
    const id = asString(payload.id);
    if (id && knownIds.has(id)) return id;
  }
  if (looksLikeLlmUsageEvent(event)) {
    const usageId = usageSubagentId(event);
    if (usageId && knownIds.has(usageId)) return usageId;
  }
  const payloadId = asString(payload.id);
  if (payloadId && knownIds.has(payloadId)) return payloadId;
  if (liveOpen.length === 1) return liveOpen[0]!;
  return "orchestrator";
}

type UsageSlice = { modelName: string; modelId?: string; calls: number; tokens: number; costUSD: number };

function emptyUsage(): UsageSlice {
  return { modelName: "", calls: 0, tokens: 0, costUSD: 0 };
}

function addUsage(target: UsageSlice, event: AgentToolEvent) {
  const parsed = parseLlmUsagePayload(event);
  if (!parsed) return;
  target.calls += 1;
  target.tokens += parsed.totalTokens;
  target.costUSD += parsed.costUSD;
  if (parsed.displayName) target.modelName = parsed.displayName;
  if (parsed.modelId) target.modelId = parsed.modelId;
}

export function buildAgentCrew(
  events: AgentToolEvent[],
  runStatus?: AgentRun["status"],
  hints?: AgentCrewHints,
): AgentCrew {
  const started = events.filter((event) => event.type === "subagent_started");
  const doneIds = new Set(
    events
      .filter((event) => event.type === "subagent_done")
      .map((event) => asString(asPayload(event.payload).id) || event.id)
      .filter(Boolean),
  );
  const lastAction = new Map<string, string>();
  const startedAt = new Map<string, string>();
  const finishedAt = new Map<string, string>();
  for (const event of events) {
    const payload = asPayload(event.payload);
    const id = asString(payload.id) || (event.type.startsWith("subagent_") ? event.id : "");
    if (event.type === "subagent_started" && id) startedAt.set(id, event.createdAt);
    if (event.type === "subagent_done" && id) finishedAt.set(id, event.createdAt);
    if (event.type !== "subagent_progress" || !id) continue;
    lastAction.set(id, event.title);
  }

  const terminal = runIsTerminal(runStatus);
  const workerName = hints?.workerModelName?.trim() || "DeepSeek V4 Flash";
  const workerId = hints?.workerModelId;
  const members: AgentCrewInstance[] = started.map((event) => {
    const payload = asPayload(event.payload);
    const id = asString(payload.id) || event.id;
    const specialist = asString(payload.specialist) || "worker";
    const task = asString(payload.task) || event.detail || "";
    const subject = asString(payload.subject) || undefined;
    const done = terminal || doneIds.has(id);
    return {
      id,
      specialist,
      name: specialistDisplayName(specialist),
      parent: asString(payload.parent) || "orchestrator",
      label: instanceLabel({ subject, task, title: event.title }),
      task,
      status: done ? "done" : "working",
      lastAction: lastAction.get(id),
      modelName: workerName,
      modelId: workerId,
      calls: 0,
      tokens: 0,
      costUSD: 0,
      startedAt: startedAt.get(id) || event.createdAt,
      finishedAt: finishedAt.get(id),
      activity: [],
      children: [],
    };
  });

  const byId = new Map(members.map((item) => [item.id, item]));
  const knownIds = new Set(members.map((item) => item.id));
  const liveOpen: string[] = [];
  const orchestratorActivity: AgentCrewActivity[] = [];
  const orchestratorUsage = emptyUsage();
  const usageById = new Map<string, UsageSlice>();

  for (const event of events) {
    const payload = asPayload(event.payload);
    if (event.type === "subagent_started") {
      const id = asString(payload.id) || event.id;
      if (id && !liveOpen.includes(id)) liveOpen.push(id);
      knownIds.add(id);
    }
    const owner = eventOwnerId(event, liveOpen, knownIds);
    const activity = toActivity(event);
    if (owner === "orchestrator") {
      pushActivity(orchestratorActivity, activity);
      if (looksLikeLlmUsageEvent(event)) addUsage(orchestratorUsage, event);
    } else {
      const member = byId.get(owner);
      if (member) {
        pushActivity(member.activity, activity);
        if (activity) member.currentAction = activity.title;
      }
      if (looksLikeLlmUsageEvent(event)) {
        const slice = usageById.get(owner) ?? emptyUsage();
        addUsage(slice, event);
        usageById.set(owner, slice);
      }
    }
    if (event.type === "subagent_done") {
      const id = asString(payload.id) || event.id;
      const index = liveOpen.indexOf(id);
      if (index >= 0) liveOpen.splice(index, 1);
    }
  }

  for (const member of members) {
    const slice = usageById.get(member.id);
    if (!slice) continue;
    member.calls = slice.calls;
    member.tokens = slice.tokens;
    member.costUSD = slice.costUSD;
    if (slice.modelName) member.modelName = slice.modelName;
    if (slice.modelId) member.modelId = slice.modelId;
  }

  const roots: AgentCrewInstance[] = [];
  for (const member of members) {
    if (isRootParent(member.parent)) {
      roots.push(member);
      continue;
    }
    const exact = byId.get(member.parent);
    const typed = [...byId.values()].filter((item) => item.specialist === member.parent && item.id !== member.id);
    const parent = exact && exact.id !== member.id
      ? exact
      : typed.find((item) => item.status === "working") ?? typed[typed.length - 1];
    if (parent) parent.children.push(member);
    else roots.push(member);
  }

  const typesMap = new Map<string, AgentCrewType>();
  const visit = (items: AgentCrewInstance[]) => {
    for (const item of items) {
      const current = typesMap.get(item.specialist) ?? {
        specialist: item.specialist,
        name: item.name,
        live: 0,
        total: 0,
      };
      current.total += 1;
      if (item.status === "working") current.live += 1;
      typesMap.set(item.specialist, current);
      visit(item.children);
    }
  };
  visit(roots);

  const live = members.filter((item) => item.status === "working").length;
  const direct = members.filter((item) => isRootParent(item.parent));
  const nested = members.filter((item) => !isRootParent(item.parent));
  const orchestratorStatus = runIsLive(runStatus) ? "working" : runIsTerminal(runStatus) ? "done" : "idle";
  const lastOrchestrator = orchestratorActivity[orchestratorActivity.length - 1];

  return {
    live,
    total: members.length,
    directLive: direct.filter((item) => item.status === "working").length,
    directTotal: direct.length,
    nestedLive: nested.filter((item) => item.status === "working").length,
    nestedTotal: nested.length,
    parallelCap: MAX_PARALLEL_SUBAGENTS,
    orchestratorStatus,
    orchestratorModelName:
      orchestratorUsage.modelName || hints?.orchestratorModelName?.trim() || "Orchestrator",
    orchestratorModelId: orchestratorUsage.modelId || hints?.orchestratorModelId,
    workerModelName: workerName,
    workerModelId: workerId,
    orchestratorAction: lastOrchestrator?.title,
    orchestratorActivity,
    orchestratorCalls: orchestratorUsage.calls,
    orchestratorTokens: orchestratorUsage.tokens,
    types: [...typesMap.values()],
    roster: AGENT_SPECIALISTS.filter((item) => item.id !== "orchestrator").map((item) => {
      const type = typesMap.get(item.id);
      return {
        specialist: item.id,
        name: item.name,
        role: item.role,
        live: type?.live ?? 0,
        total: type?.total ?? 0,
      };
    }),
    children: roots,
  };
}
