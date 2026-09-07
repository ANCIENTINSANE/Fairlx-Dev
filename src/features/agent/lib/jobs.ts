import { Databases, ID, Query } from "node-appwrite";

import { AGENT_JOBS_ID, DATABASE_ID } from "@/config";
import type { AgentJob, AgentJobKind, AgentJobStatus } from "../types";
import { parseJson, stringifyBounded } from "../lib/truncate";

type JobDocument = {
  $id: string;
  $createdAt: string;
  $updatedAt?: string;
  userId: string;
  runId?: string;
  kind: AgentJobKind;
  status: AgentJobStatus;
  progressJson: string;
  payloadJson: string;
  resultJson?: string;
  error?: string;
};

function parseJob(doc: JobDocument): AgentJob {
  return {
    id: doc.$id,
    userId: doc.userId,
    runId: doc.runId || undefined,
    kind: doc.kind,
    status: doc.status,
    progress: parseJson(doc.progressJson, { step: "queued", percent: 0 }),
    payload: parseJson(doc.payloadJson, {}),
    result: doc.resultJson ? parseJson(doc.resultJson, {}) : undefined,
    error: doc.error || undefined,
    createdAt: doc.$createdAt,
    updatedAt: doc.$updatedAt || doc.$createdAt,
  };
}

export async function createAgentJob(
  databases: Databases,
  input: {
    userId: string;
    runId?: string;
    kind: AgentJobKind;
    payload: Record<string, unknown>;
    status?: AgentJobStatus;
  },
): Promise<AgentJob | null> {
  try {
    const doc = await databases.createDocument(DATABASE_ID, AGENT_JOBS_ID, ID.unique(), {
      userId: input.userId,
      runId: input.runId || "",
      kind: input.kind,
      status: input.status || "queued",
      progressJson: stringifyBounded({ step: input.status === "scheduled" ? "scheduled" : "queued", percent: 0 }, 2048),
      payloadJson: stringifyBounded(input.payload),
      resultJson: stringifyBounded({}),
      error: "",
    });
    return parseJob(doc as unknown as JobDocument);
  } catch (error) {
    console.error("[agent] failed to create job", error);
    return null;
  }
}

export async function getAgentJob(databases: Databases, userId: string, jobId: string): Promise<AgentJob | null> {
  try {
    const doc = await databases.getDocument(DATABASE_ID, AGENT_JOBS_ID, jobId);
    const job = parseJob(doc as unknown as JobDocument);
    return job.userId === userId ? job : null;
  } catch {
    return null;
  }
}

export async function listAgentJobs(databases: Databases, userId: string, limit = 20): Promise<AgentJob[]> {
  try {
    const result = await databases.listDocuments(DATABASE_ID, AGENT_JOBS_ID, [
      Query.equal("userId", userId),
      Query.orderDesc("$createdAt"),
      Query.limit(Math.min(limit, 50)),
    ]);
    return result.documents.map((doc) => parseJob(doc as unknown as JobDocument));
  } catch {
    return [];
  }
}

export async function updateAgentJob(
  databases: Databases,
  jobId: string,
  patch: Partial<{
    status: AgentJobStatus;
    progress: { step: string; percent: number };
    result: Record<string, unknown>;
    payload: Record<string, unknown>;
    error: string;
  }>,
): Promise<AgentJob | null> {
  try {
    const payload: Record<string, string> = {};
    if (patch.status) payload.status = patch.status;
    if (patch.progress) payload.progressJson = stringifyBounded(patch.progress, 2048);
    if (patch.result) payload.resultJson = stringifyBounded(patch.result);
    if (patch.payload) payload.payloadJson = stringifyBounded(patch.payload);
    if (patch.error !== undefined) payload.error = patch.error.slice(0, 2000);
    const doc = await databases.updateDocument(DATABASE_ID, AGENT_JOBS_ID, jobId, payload);
    return parseJob(doc as unknown as JobDocument);
  } catch (error) {
    console.error("[agent] failed to update job", error);
    return null;
  }
}

export async function claimQueuedJobs(databases: Databases, userId: string): Promise<AgentJob[]> {
  try {
    const result = await databases.listDocuments(DATABASE_ID, AGENT_JOBS_ID, [
      Query.equal("userId", userId),
      Query.equal("status", "queued"),
      Query.limit(5),
    ]);
    return result.documents
      .map((doc) => parseJob(doc as unknown as JobDocument))
      .filter((job) => job.kind !== "personal_standin");
  } catch {
    return [];
  }
}

export async function getAgentJobById(databases: Databases, jobId: string): Promise<AgentJob | null> {
  try {
    const doc = await databases.getDocument(DATABASE_ID, AGENT_JOBS_ID, jobId);
    return parseJob(doc as unknown as JobDocument);
  } catch {
    return null;
  }
}

export async function listStandinJobs(
  databases: Databases,
  filters: { userId?: string; status?: AgentJobStatus | AgentJobStatus[]; limit?: number },
): Promise<AgentJob[]> {
  const limit = Math.min(filters.limit ?? 40, 80);
  const parseDocs = (docs: unknown[]) => docs.map((doc) => parseJob(doc as unknown as JobDocument));
  try {
    const queries = [Query.equal("kind", "personal_standin"), Query.limit(limit)];
    if (filters.userId) queries.push(Query.equal("userId", filters.userId));
    if (typeof filters.status === "string") queries.push(Query.equal("status", filters.status));
    else if (Array.isArray(filters.status) && filters.status.length === 1) {
      queries.push(Query.equal("status", filters.status[0]!));
    }
    const result = await databases.listDocuments(DATABASE_ID, AGENT_JOBS_ID, queries);
    let jobs = parseDocs(result.documents);
    if (Array.isArray(filters.status) && filters.status.length > 1) {
      const wanted = new Set(filters.status);
      jobs = jobs.filter((job) => wanted.has(job.status));
    }
    return jobs;
  } catch {
    try {
      const queries = [Query.limit(limit)];
      if (filters.userId) queries.push(Query.equal("userId", filters.userId));
      if (typeof filters.status === "string") queries.push(Query.equal("status", filters.status));
      const result = await databases.listDocuments(DATABASE_ID, AGENT_JOBS_ID, queries);
      return parseDocs(result.documents).filter((job) => job.kind === "personal_standin");
    } catch {
      return [];
    }
  }
}
