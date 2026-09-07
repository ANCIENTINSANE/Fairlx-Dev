import type { Databases } from "node-appwrite";

import { loadAgentContext } from "./context";
import { getOrCreateHarness } from "./harness";
import { createRun, updateRun } from "./runs";
import { scheduleAgentTurn } from "./schedule-turn";
import { createAgentJob } from "./jobs";
import { scheduleAgentJob } from "./schedule-job";
import {
  appendSessionEvent,
  findActiveCodingSessionForWorkItem,
  isFairlxAgentAssignee,
  mentionsFairlxAgent,
  triageStatus,
  updateCodingSession,
} from "./coding-sessions";

type WorkItemLike = {
  $id?: string;
  id?: string;
  key?: string;
  title?: string;
  projectId?: string;
  workspaceId?: string;
  status?: string;
};

function workItemId(item: WorkItemLike): string {
  return String(item.$id || item.id || "");
}

export async function maybeStartSessionFromAssignees(params: {
  databases: Databases;
  userId: string;
  workItem: WorkItemLike;
  assigneeIds: string[];
  user?: { $id: string; name?: string; email?: string };
}): Promise<void> {
  if (!isFairlxAgentAssignee(params.assigneeIds)) return;
  const itemId = workItemId(params.workItem);
  if (!itemId || !params.workItem.projectId || !params.workItem.workspaceId) return;
  const existing = await findActiveCodingSessionForWorkItem(params.databases, itemId);
  const prompt = `Start a coding session for ${params.workItem.key || itemId}: ${params.workItem.title || "work item"}. Call coding_session_start, then implement in the Azure sandbox.`;
  const run = await createRun(params.databases, {
    userId: params.userId,
    prompt,
    mode: "agent",
    workspaceId: String(params.workItem.workspaceId),
    projectId: String(params.workItem.projectId),
    title: `Session ${params.workItem.key || itemId}`,
  });
  await updateRun(params.databases, run.id, { extra: { kind: "coding_session", sessionId: existing?.id } });
  if (existing) {
    await updateCodingSession(params.databases, existing.id, {
      runId: run.id,
      status: existing.status === "queued" ? "preparing" : existing.status,
      events: appendSessionEvent(existing.events, "assigned", "Fairlx Agent assigned — resuming session"),
    });
  }
  const harness = await getOrCreateHarness(params.databases, params.userId);
  const context = await loadAgentContext(params.databases, {
    $id: params.userId,
    name: params.user?.name || "Fairlx Agent",
    email: params.user?.email || "",
  } as never);
  const job = await createAgentJob(params.databases, {
    userId: params.userId,
    runId: run.id,
    kind: "coding_session",
    payload: {
      workItemId: itemId,
      projectId: params.workItem.projectId,
    },
  });
  if (job) {
    scheduleAgentJob({
      databases: params.databases,
      userId: params.userId,
      jobId: job.id,
      context,
      plugins: harness.plugins,
      harness,
      projectId: String(params.workItem.projectId),
      workspaceId: String(params.workItem.workspaceId),
    });
  }
  const user = params.user ?? { $id: params.userId, name: "Fairlx Agent", email: "" };
  scheduleAgentTurn({ databases: params.databases, user: user as never, run });
}

export async function maybeTriageCodingSession(params: {
  databases: Databases;
  userId: string;
  workItem: WorkItemLike;
  status?: string;
  user?: { $id: string; name?: string; email?: string };
}): Promise<void> {
  const wanted = triageStatus();
  if (!wanted) return;
  const status = String(params.status || params.workItem.status || "");
  if (status.toLowerCase() !== wanted.toLowerCase()) return;
  const itemId = workItemId(params.workItem);
  if (!itemId) return;
  const existing = await findActiveCodingSessionForWorkItem(params.databases, itemId);
  if (existing) return;
  const prompt = `Triage first pass for ${params.workItem.key || itemId}: ${params.workItem.title || "work item"}. Investigate with read-only GitHub and work-item tools. If you are confident a coding session should start, call coding_session_start (Accept-gated).`;
  const run = await createRun(params.databases, {
    userId: params.userId,
    prompt,
    mode: "agent",
    workspaceId: String(params.workItem.workspaceId || ""),
    projectId: String(params.workItem.projectId || ""),
    title: `Triage ${params.workItem.key || itemId}`,
  });
  await updateRun(params.databases, run.id, { extra: { kind: "coding_session" } });
  const user = params.user ?? { $id: params.userId };
  scheduleAgentTurn({ databases: params.databases, user: user as never, run });
}

export async function maybeAttachFairlxMention(params: {
  databases: Databases;
  userId: string;
  workItemId: string;
  content: string;
}): Promise<void> {
  if (!mentionsFairlxAgent(params.content)) return;
  const session = await findActiveCodingSessionForWorkItem(params.databases, params.workItemId);
  if (!session?.runId) return;
  await updateCodingSession(params.databases, session.id, {
    status: session.status === "awaiting_review" ? "iterating" : session.status,
    events: appendSessionEvent(session.events, "mention", params.content.slice(0, 500)),
  });
  const { getRun } = await import("./runs");
  const run = await getRun(params.databases, params.userId, session.runId);
  if (!run) return;
  const { updateRun } = await import("./runs");
  await updateRun(params.databases, run.id, {
    status: run.status === "completed" || run.status === "stopped" ? "running" : run.status,
    messages: [
      ...run.messages,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: `@Fairlx comment on ${params.workItemId}: ${params.content}`,
        createdAt: new Date().toISOString(),
      },
    ],
  });
  const { scheduleAgentTurn } = await import("./schedule-turn");
  scheduleAgentTurn({
    databases: params.databases,
    user: { $id: params.userId, name: "Fairlx", email: "" } as never,
    run: { ...run, status: "running" },
  });
}
