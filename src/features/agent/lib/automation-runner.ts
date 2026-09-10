import type { Databases } from "node-appwrite";

import type { AgentAutomation, AgentHarness, AgentRun } from "../types";
import {
  automationMatchesEvent,
  compileAutomationPrompt,
  supervisorNodes,
  type AutomationEvent,
} from "./automation-flow";
import { getOrCreateHarness, listAllHarnesses, upsertHarness } from "./harness";
import { runIsWaitingForSandbox } from "./implementation-plan";
import { createRun, updateRun } from "./runs";
import { scheduleAgentTurn } from "./schedule-turn";
import { postSlackMessage, slackIntegrationForProject, slackIntegrationForWorkspace } from "../plugins/slack";
import { notifyInApp } from "../plugins/notify-channel";

/**
 * Fires automation loops. Called from work-item routes, comment routes, and chat webhooks.
 * Everything here is fire-and-forget from the caller's point of view: failures are logged and
 * never break the request that created the work item.
 */

type Match = { harness: AgentHarness; automation: AgentAutomation };

/** One automation per item per 10 minutes — Slack retries and double PATCHes must not fan out. */
const recentFires = new Map<string, number>();
const FIRE_WINDOW_MS = 10 * 60 * 1000;

function fireKey(automationId: string, event: AutomationEvent): string {
  return `${automationId}:${event.kind}:${event.workItem?.id || event.text?.slice(0, 40) || "-"}`;
}

function alreadyFired(key: string, now = Date.now()): boolean {
  for (const [entry, at] of recentFires) if (now - at > FIRE_WINDOW_MS) recentFires.delete(entry);
  if (recentFires.has(key)) return true;
  recentFires.set(key, now);
  return false;
}

export function resetAutomationFireWindow(): void {
  recentFires.clear();
}

export async function findMatchingAutomations(databases: Databases, event: AutomationEvent): Promise<Match[]> {
  const harnesses = await listAllHarnesses(databases);
  const matches: Match[] = [];
  for (const harness of harnesses) {
    for (const automation of harness.automations) {
      if (!automation.flow) continue;
      if (automationMatchesEvent(automation, event)) matches.push({ harness, automation });
    }
  }
  return matches;
}

export type AutomationFireResult = { automationId: string; runId?: string; userId: string; skipped?: string };

export async function fireAutomation(
  databases: Databases,
  match: Match,
  event: AutomationEvent,
  options?: { force?: boolean },
): Promise<AutomationFireResult> {
  const { harness, automation } = match;
  const key = fireKey(automation.id, event);
  if (!options?.force && alreadyFired(key)) {
    return { automationId: automation.id, userId: harness.userId, skipped: "recently fired" };
  }
  const prompt = compileAutomationPrompt(automation, event);
  const item = event.workItem;
  const run = await createRun(databases, {
    userId: harness.userId,
    prompt,
    mode: "agent",
    workspaceId: event.workspaceId || automation.workspaceId || harness.settings.defaultWorkspaceId,
    projectId: event.projectId || automation.projectId || harness.settings.defaultProjectId,
    title: `Auto · ${automation.name}${item?.key ? ` · ${item.key}` : ""}`,
    kind: "automation",
    autonomousCoding: true,
    automationId: automation.id,
  });
  await updateRun(databases, run.id, {
    extra: { kind: "automation", autonomousCoding: true, automationId: automation.id },
  });
  void upsertHarness(databases, harness.userId, {
    automations: harness.automations.map((entry) =>
      entry.id === automation.id
        ? { ...entry, lastRunAt: new Date().toISOString(), runCount: (entry.runCount || 0) + 1 }
        : entry,
    ),
  }).catch(() => {});
  void notifySupervisors(databases, { automation, event, run, phase: "start" }).catch(() => {});
  scheduleAgentTurn({
    databases,
    user: { $id: harness.userId, name: event.actor?.name || "Fairlx automation", email: "" },
    run: { ...run, autonomousCoding: true },
  });
  return { automationId: automation.id, runId: run.id, userId: harness.userId };
}

/** Entry point used by routes/webhooks. Never throws. */
export async function dispatchAutomationEvent(
  databases: Databases,
  event: AutomationEvent,
): Promise<AutomationFireResult[]> {
  try {
    const matches = await findMatchingAutomations(databases, event);
    const results: AutomationFireResult[] = [];
    for (const match of matches) {
      try {
        results.push(await fireAutomation(databases, match, event));
      } catch (error) {
        console.error("[automation] fire failed", match.automation.id, error instanceof Error ? error.message : error);
      }
    }
    return results;
  } catch (error) {
    console.error("[automation] dispatch failed", error instanceof Error ? error.message : error);
    return [];
  }
}

export type SupervisorPhase = "start" | "fail" | "done" | "approval";

function phaseTitle(phase: SupervisorPhase, automation: AgentAutomation): string {
  switch (phase) {
    case "start":
      return `Fairlx started “${automation.name}”`;
    case "fail":
      return `Fairlx hit a failure in “${automation.name}”`;
    case "approval":
      return `“${automation.name}” needs your approval`;
    default:
      return `Fairlx finished “${automation.name}”`;
  }
}

/**
 * Tell every supervisor node's target about a phase change. Targets are a Fairlx user id,
 * an email (matched later by the notify channel), or empty = the harness owner.
 */
export async function notifySupervisors(
  databases: Databases,
  params: {
    automation: AgentAutomation;
    event: AutomationEvent;
    run?: Pick<AgentRun, "id" | "userId" | "workspaceId" | "projectId">;
    phase: SupervisorPhase;
    detail?: string;
  },
): Promise<void> {
  const supervisors = supervisorNodes(params.automation.flow);
  if (!supervisors.length) return;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
  const item = params.event.workItem;
  const title = phaseTitle(params.phase, params.automation);
  const message = [
    item ? `${item.key || item.id}: ${item.title || ""}`.trim() : "",
    params.detail || "",
    params.run ? `${appUrl}/agent/workflow?runId=${params.run.id}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  for (const node of supervisors) {
    const notifyOn = Array.isArray(node.config.notifyOn) ? node.config.notifyOn.map(String) : ["start", "fail", "done"];
    if (params.phase !== "approval" && !notifyOn.includes(params.phase)) continue;
    const target = String(node.config.target || "").trim();
    const userId = target && !target.includes("@") && !target.startsWith("#") ? target : params.run?.userId || "";
    if (userId) {
      await notifyInApp(databases, {
        userId,
        title,
        message,
        workspaceId: params.run?.workspaceId || params.event.workspaceId,
        workItemId: item?.id,
        runId: params.run?.id,
      });
    }
    const channel = String(node.config.channel || "in_app");
    if (channel === "slack") {
      const projectId = params.run?.projectId || params.event.projectId || "";
      const slack =
        (projectId ? await slackIntegrationForProject(databases, projectId) : null) ??
        (params.event.workspaceId ? await slackIntegrationForWorkspace(databases, params.event.workspaceId) : null);
      const slackChannel = target.startsWith("#") ? target : slack?.channelId || "";
      if (slack?.token && slackChannel) {
        await postSlackMessage({ token: slack.token, channel: slackChannel, text: `*${title}*\n${message}` });
      }
    }
  }
}

/** Once per run + phase: a run persists "completed" at the end of every turn, not only the last one. */
const outcomeNotified = new Map<string, number>();

/**
 * Called by the runtime when an automation run finishes a turn as completed/failed. Skips the
 * "done" ping while the sandbox is still preparing (a scheduled follow-up turn continues the loop)
 * and turns a pending confirmation into an "approval" ping.
 */
export async function notifyAutomationOutcome(
  databases: Databases,
  run: AgentRun,
  status: "completed" | "failed",
  error?: string,
): Promise<void> {
  if (!run.automationId) return;
  const phase: SupervisorPhase =
    status === "failed" ? "fail" : run.events.some((event) => event.type === "confirmation") ? "approval" : "done";
  if (phase === "done" && runIsWaitingForSandbox(run)) return;
  const key = `${run.id}:${phase}`;
  const now = Date.now();
  for (const [entry, at] of outcomeNotified) if (now - at > 6 * 60 * 60 * 1000) outcomeNotified.delete(entry);
  if (outcomeNotified.has(key)) return;
  outcomeNotified.set(key, now);

  const harness = await getOrCreateHarness(databases, run.userId);
  const automation = harness.automations.find((entry) => entry.id === run.automationId);
  if (!automation?.flow) return;
  const keyMatch = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/.exec(run.title || run.prompt || "");
  const lastAssistant = [...run.messages].reverse().find((message) => message.role === "assistant")?.content || "";
  await notifySupervisors(databases, {
    automation,
    event: {
      kind: "manual",
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      workItem: keyMatch ? { id: "", key: keyMatch[1] } : undefined,
    },
    run,
    phase,
    detail: (error || lastAssistant).replace(/\s+/g, " ").slice(0, 400),
  });
}

/** Build the event for a work item document coming out of the work-items routes. */
export function workItemAutomationEvent(
  kind: AutomationEvent["kind"],
  doc: Record<string, unknown>,
  extra?: Partial<AutomationEvent>,
): AutomationEvent {
  return {
    kind,
    workspaceId: String(doc.workspaceId || extra?.workspaceId || ""),
    projectId: String(doc.projectId || extra?.projectId || ""),
    workItem: {
      id: String(doc.$id || doc.id || ""),
      key: doc.key ? String(doc.key) : undefined,
      title: doc.title ? String(doc.title) : undefined,
      description: doc.description ? String(doc.description) : undefined,
      type: doc.type ? String(doc.type) : undefined,
      status: doc.status ? String(doc.status) : undefined,
      priority: doc.priority ? String(doc.priority) : undefined,
      assigneeIds: Array.isArray(doc.assigneeIds) ? (doc.assigneeIds as string[]) : undefined,
    },
    ...extra,
  };
}
