import { Databases, ID, Query } from "node-appwrite";

import { AGENT_CODING_SESSIONS_ID, DATABASE_ID } from "@/config";
import type { CodingSession, CodingSessionEvent, CodingSessionMeta, CodingSessionStatus } from "../types";
import { parseJson, stringifyBounded } from "./truncate";
import { mentionsFairlxAgent as mentionDetect } from "./mentions";

type SessionDocument = {
  $id: string;
  $createdAt: string;
  $updatedAt?: string;
  userId: string;
  workItemId: string;
  projectId: string;
  workspaceId: string;
  runId?: string;
  repoId?: string;
  baseBranch?: string;
  headBranch?: string;
  status: CodingSessionStatus;
  sandboxId?: string;
  previewUrl?: string;
  prNumber?: string;
  prUrl?: string;
  orchestratorModelId?: string;
  workerModelId?: string;
  eventsJson: string;
  metaJson?: string;
};

function metaFromEvents(events: CodingSessionEvent[]): CodingSessionMeta {
  const event = [...events].reverse().find((item) => item.type === "session_meta");
  const payload = event?.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? (event.payload as CodingSessionMeta)
    : {};
  return payload;
}

export function withSessionMeta(events: CodingSessionEvent[], meta: CodingSessionMeta): CodingSessionEvent[] {
  return appendSessionEvent(events, "session_meta", "Session preview state", meta);
}

function parseSession(doc: SessionDocument): CodingSession {
  const prNumberRaw = doc.prNumber ? Number(doc.prNumber) : undefined;
  const events = parseJson<CodingSessionEvent[]>(doc.eventsJson, []);
  const meta = {
    ...metaFromEvents(events),
    ...parseJson<CodingSessionMeta>(doc.metaJson || "", {}),
  };
  return {
    id: doc.$id,
    userId: doc.userId,
    workItemId: doc.workItemId,
    projectId: doc.projectId,
    workspaceId: doc.workspaceId,
    runId: doc.runId || undefined,
    repoId: doc.repoId || undefined,
    baseBranch: doc.baseBranch || undefined,
    headBranch: doc.headBranch || undefined,
    status: doc.status,
    sandboxId: doc.sandboxId || undefined,
    previewUrl: doc.previewUrl || undefined,
    prNumber: Number.isFinite(prNumberRaw) ? prNumberRaw : undefined,
    prUrl: doc.prUrl || undefined,
    orchestratorModelId: doc.orchestratorModelId || undefined,
    workerModelId: doc.workerModelId || undefined,
    events,
    driver: meta.driver,
    previewLive: meta.previewLive,
    codingAgent: meta.codingAgent,
    codingAgentReason: meta.codingAgentReason,
    artifacts: meta.artifacts,
    meta,
    createdAt: doc.$createdAt,
    updatedAt: doc.$updatedAt || doc.$createdAt,
  };
}

function toPayload(input: Partial<CodingSession> & { userId?: string; meta?: CodingSessionMeta }): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.userId !== undefined) payload.userId = input.userId;
  if (input.workItemId !== undefined) payload.workItemId = input.workItemId;
  if (input.projectId !== undefined) payload.projectId = input.projectId;
  if (input.workspaceId !== undefined) payload.workspaceId = input.workspaceId;
  if (input.runId !== undefined) payload.runId = input.runId || "";
  if (input.repoId !== undefined) payload.repoId = input.repoId || "";
  if (input.baseBranch !== undefined) payload.baseBranch = input.baseBranch || "";
  if (input.headBranch !== undefined) payload.headBranch = input.headBranch || "";
  if (input.status !== undefined) payload.status = input.status;
  if (input.sandboxId !== undefined) payload.sandboxId = input.sandboxId || "";
  if (input.previewUrl !== undefined) payload.previewUrl = input.previewUrl || "";
  if (input.prNumber !== undefined) payload.prNumber = input.prNumber != null ? String(input.prNumber) : "";
  if (input.prUrl !== undefined) payload.prUrl = input.prUrl || "";
  if (input.orchestratorModelId !== undefined) payload.orchestratorModelId = input.orchestratorModelId || "";
  if (input.workerModelId !== undefined) payload.workerModelId = input.workerModelId || "";
  if (input.events !== undefined) payload.eventsJson = stringifyBounded(input.events, 1_048_576);
  if (input.meta !== undefined) payload.metaJson = stringifyBounded(input.meta, 16_384);
  return payload;
}

export function appendSessionEvent(
  events: CodingSessionEvent[],
  type: string,
  detail?: string,
  payload?: unknown,
): CodingSessionEvent[] {
  return [
    ...events,
    {
      id: crypto.randomUUID(),
      type,
      detail,
      payload,
      createdAt: new Date().toISOString(),
    },
  ].slice(-80);
}

export async function createCodingSession(
  databases: Databases,
  input: {
    userId: string;
    workItemId: string;
    projectId: string;
    workspaceId: string;
    runId?: string;
    repoId?: string;
    baseBranch?: string;
    headBranch?: string;
    orchestratorModelId?: string;
    workerModelId?: string;
  },
): Promise<CodingSession | null> {
  try {
    const events = appendSessionEvent([], "queued", "Coding session queued");
    const doc = await databases.createDocument(DATABASE_ID, AGENT_CODING_SESSIONS_ID, ID.unique(), {
      userId: input.userId,
      workItemId: input.workItemId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      runId: input.runId || "",
      repoId: input.repoId || "",
      baseBranch: input.baseBranch || "main",
      headBranch: input.headBranch || "",
      status: "queued",
      sandboxId: "",
      previewUrl: "",
      prNumber: "",
      prUrl: "",
      orchestratorModelId: input.orchestratorModelId || "",
      workerModelId: input.workerModelId || "",
      eventsJson: stringifyBounded(events, 1_048_576),
    });
    return parseSession(doc as unknown as SessionDocument);
  } catch (error) {
    console.error("[agent] failed to create coding session", error);
    return null;
  }
}

export async function getCodingSession(
  databases: Databases,
  sessionId: string,
): Promise<CodingSession | null> {
  try {
    const doc = await databases.getDocument(DATABASE_ID, AGENT_CODING_SESSIONS_ID, sessionId);
    return parseSession(doc as unknown as SessionDocument);
  } catch {
    return null;
  }
}

export async function updateCodingSession(
  databases: Databases,
  sessionId: string,
  patch: Partial<CodingSession> & { meta?: CodingSessionMeta },
): Promise<CodingSession | null> {
  try {
    const payload = toPayload(patch);
    const doc = await databases.updateDocument(DATABASE_ID, AGENT_CODING_SESSIONS_ID, sessionId, payload);
    return parseSession(doc as unknown as SessionDocument);
  } catch (error) {
    if (patch.meta !== undefined) {
      try {
        const payload = toPayload({ ...patch, meta: undefined });
        delete payload.metaJson;
        const doc = await databases.updateDocument(DATABASE_ID, AGENT_CODING_SESSIONS_ID, sessionId, payload);
        return parseSession(doc as unknown as SessionDocument);
      } catch (retryError) {
        console.error("[agent] failed to update coding session", retryError);
        return null;
      }
    }
    console.error("[agent] failed to update coding session", error);
    return null;
  }
}

export async function findCodingSessionByRun(
  databases: Databases,
  runId: string,
): Promise<CodingSession | null> {
  try {
    const listed = await databases.listDocuments(DATABASE_ID, AGENT_CODING_SESSIONS_ID, [
      Query.equal("runId", runId),
      Query.limit(1),
    ]);
    const doc = listed.documents[0];
    return doc ? parseSession(doc as unknown as SessionDocument) : null;
  } catch {
    return null;
  }
}

export async function findActiveCodingSessionForWorkItem(
  databases: Databases,
  workItemId: string,
): Promise<CodingSession | null> {
  try {
    const listed = await databases.listDocuments(DATABASE_ID, AGENT_CODING_SESSIONS_ID, [
      Query.equal("workItemId", workItemId),
      Query.orderDesc("$createdAt"),
      Query.limit(8),
    ]);
    const active = listed.documents
      .map((doc) => parseSession(doc as unknown as SessionDocument))
      .find((session) => !["merged", "failed", "stopped"].includes(session.status));
    return active ?? null;
  } catch {
    return null;
  }
}

export async function listCodingSessionsForProject(
  databases: Databases,
  projectId: string,
  limit = 20,
): Promise<CodingSession[]> {
  try {
    const listed = await databases.listDocuments(DATABASE_ID, AGENT_CODING_SESSIONS_ID, [
      Query.equal("projectId", projectId),
      Query.orderDesc("$createdAt"),
      Query.limit(Math.min(limit, 50)),
    ]);
    return listed.documents.map((doc) => parseSession(doc as unknown as SessionDocument));
  } catch {
    return [];
  }
}

export function fairlxAgentIds(): string[] {
  return [process.env.FAIRLX_AGENT_USER_ID, process.env.FAIRLX_AGENT_MEMBER_ID, "fairlx-agent"]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

export function isFairlxAgentAssignee(ids: string[]): boolean {
  const known = new Set(fairlxAgentIds().map((id) => id.toLowerCase()));
  return ids.some((id) => known.has(id.toLowerCase()));
}

export function mentionsFairlxAgent(text: string): boolean {
  return mentionDetect(text);
}

export function triageStatus(): string {
  return process.env.FAIRLX_CODING_TRIAGE_STATUS?.trim() || "";
}

export function guidedWalkthrough(
  files: Array<{ filename: string; status?: string; additions?: number; deletions?: number; patch?: string }>,
): string | undefined {
  if (!files.length) return undefined;
  const lines = files.slice(0, 12).map((file) => {
    const hunks = file.patch?.match(/^@@/gm)?.length ?? 0;
    const plus = file.additions ?? 0;
    const minus = file.deletions ?? 0;
    const status = file.status || "modified";
    return `${status} ${file.filename} (+${plus}/-${minus}${hunks ? `, ${hunks} hunk${hunks === 1 ? "" : "s"}` : ""})`;
  });
  const rest = files.length > 12 ? `\n…and ${files.length - 12} more files.` : "";
  return `What changed (${files.length} file${files.length === 1 ? "" : "s"}):\n${lines.join("\n")}${rest}`;
}
