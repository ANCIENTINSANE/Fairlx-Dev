import type { AgentRun, AgentToolEvent } from "../types";
import { AGENT_SPECIALISTS } from "./graph";

export type AgentCrewStatus = "working" | "done" | "idle";

export type AgentCrewInstance = {
  id: string;
  specialist: string;
  name: string;
  parent: string;
  label: string;
  task: string;
  status: "working" | "done";
  lastAction?: string;
  children: AgentCrewInstance[];
};

export type AgentCrewType = {
  specialist: string;
  name: string;
  live: number;
  total: number;
};

export type AgentCrew = {
  live: number;
  total: number;
  orchestratorStatus: AgentCrewStatus;
  types: AgentCrewType[];
  children: AgentCrewInstance[];
};

const ROOT_PARENTS = new Set(["", "orchestrator", "main", "parent"]);

export function specialistDisplayName(id: string): string {
  const known = AGENT_SPECIALISTS.find((item) => item.id === id);
  if (known) return known.name;
  if (!id) return "Specialist";
  return id.charAt(0).toUpperCase() + id.slice(1);
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

export function buildAgentCrew(events: AgentToolEvent[], runStatus?: AgentRun["status"]): AgentCrew {
  const started = events.filter((event) => event.type === "subagent_started");
  const doneIds = new Set(
    events
      .filter((event) => event.type === "subagent_done")
      .map((event) => asString(asPayload(event.payload).id) || event.id)
      .filter(Boolean),
  );
  const lastAction = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "subagent_progress") continue;
    const id = asString(asPayload(event.payload).id);
    if (!id) continue;
    lastAction.set(id, event.title);
  }

  const terminal = runIsTerminal(runStatus);
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
      children: [],
    };
  });

  const byId = new Map(members.map((item) => [item.id, item]));
  const roots: AgentCrewInstance[] = [];
  for (const member of members) {
    if (ROOT_PARENTS.has(member.parent.toLowerCase())) {
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
  const orchestratorStatus = runIsLive(runStatus) ? "working" : runIsTerminal(runStatus) ? "done" : "idle";

  return {
    live,
    total: members.length,
    orchestratorStatus,
    types: [...typesMap.values()],
    children: roots,
  };
}
