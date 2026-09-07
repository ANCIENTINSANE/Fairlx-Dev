import { createHmac, timingSafeEqual } from "crypto";
import { ID, Query, type Databases } from "node-appwrite";

import { COMMENTS_ID, DATABASE_ID, MEMBERS_ID, TASKS_ID } from "@/config";
import { createAdminClient } from "@/lib/appwrite";
import { standinApprovalTemplate } from "@/lib/email-templates/standin-approval";
import { extractMentions } from "@/lib/mentions";
import { profileIsTrained } from "./personal-agent-status";
import { getPersonalAgent } from "./personal-agent-store";
import { completePlainText } from "./complete-text";
import { defaultAiStoredConfig, mergePlatformAiConfig } from "./defaults";
import { getAiDocument, parseAiConfig } from "./store";
import { createAgentJob, getAgentJobById, listStandinJobs, updateAgentJob } from "./jobs";
import { isFairlxAgentAssignee } from "./coding-sessions";
import type { AgentJob, PersonalAgentProfile, PersonalTrainingAnswer } from "../types";

export { listStandinJobs };

export const PERSONAL_STANDIN_AUTHOR_ID = "personal-agent";
export const STANDIN_WAIT_MS = Number(process.env.FAIRLX_STANDIN_WAIT_MS) || 5 * 60 * 1000;
export const STANDIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const STANDIN_AUTO_POST_PER_HOUR = 5;

export type StandinTrigger = "mention" | "assignment" | "reply";
export type StandinClass = "routine" | "needs_you";

export type StandinPayload = {
  trigger: StandinTrigger;
  triggerId: string;
  taskId: string;
  workspaceId: string;
  projectId?: string;
  commentId?: string;
  snippet: string;
  runAt: string;
  userName?: string;
  actorUserId?: string;
  actorName?: string;
};

const FORCE_NEEDS_YOU =
  /\b(estimates?|deadlines?|story points|assign (me|them|him|her|us)|I('ll| will) (take|own|ship|deliver|have it)|merge to (main|master|prod)|production|deletes?|promot(?:e|ion)|salary|leadership|commit to|promise)\b/i;

function standinSecret(): string {
  return process.env.AGENT_STANDIN_SECRET || process.env.CRON_SECRET || "fairlx-standin-dev";
}

export function signStandinToken(jobId: string, action: "approve" | "self"): string {
  return createHmac("sha256", standinSecret()).update(`${jobId}:${action}`).digest("hex");
}

export function verifyStandinToken(jobId: string, action: "approve" | "self", token: string): boolean {
  if (!token) return false;
  const expected = signStandinToken(jobId, action);
  const left = Buffer.from(expected);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function asPayload(job: AgentJob): StandinPayload {
  const raw = job.payload as Partial<StandinPayload>;
  return {
    trigger: raw.trigger === "assignment" || raw.trigger === "reply" ? raw.trigger : "mention",
    triggerId: String(raw.triggerId || job.id),
    taskId: String(raw.taskId || ""),
    workspaceId: String(raw.workspaceId || ""),
    projectId: typeof raw.projectId === "string" ? raw.projectId : undefined,
    commentId: typeof raw.commentId === "string" ? raw.commentId : undefined,
    snippet: String(raw.snippet || ""),
    runAt: String(raw.runAt || job.createdAt),
    userName: typeof raw.userName === "string" ? raw.userName : undefined,
    actorUserId: typeof raw.actorUserId === "string" ? raw.actorUserId : undefined,
    actorName: typeof raw.actorName === "string" ? raw.actorName : undefined,
  };
}

export function stripStandinMentions(text: string): string {
  return text
    .replace(/<span[^>]*data-type="mention"[^>]*>.*?<\/span>/gi, "")
    .replace(/@[\w.\- ]+\[[^\]]+\]/g, "")
    .replace(/@[A-Za-z][\w.\-]*/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function standinCommentBody(userName: string, draft: string): string {
  const clean = stripStandinMentions(draft);
  return `*Personal Agent for ${userName}*\n\n${clean}`;
}

export function shouldForceNeedsYou(draft: string, answers: PersonalTrainingAnswer[] = []): boolean {
  if (FORCE_NEEDS_YOU.test(draft)) return true;
  const neverDo = answers.find((item) => item.questionId === "never_do")?.answer || "";
  if (!neverDo.trim()) return false;
  const tokens = neverDo
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 4)
    .slice(0, 12);
  const lower = draft.toLowerCase();
  return tokens.some((token) => lower.includes(token));
}

async function resolveMemberUserId(databases: Databases, assigneeId: string): Promise<string | null> {
  try {
    const member = await databases.getDocument(DATABASE_ID, MEMBERS_ID, assigneeId);
    const userId = String((member as { userId?: string }).userId || "");
    return userId || assigneeId;
  } catch {
    return assigneeId || null;
  }
}

export async function maybeEnqueueStandinFromComment(params: {
  databases: Databases;
  authorId: string;
  authorName?: string;
  taskId: string;
  workspaceId: string;
  projectId?: string;
  commentId: string;
  content: string;
  parentAuthorId?: string;
}): Promise<void> {
  if (params.authorId === PERSONAL_STANDIN_AUTHOR_ID) return;
  const mentioned = extractMentions(params.content).filter((id) => id && id !== params.authorId);
  const targets = new Set(mentioned);
  if (params.parentAuthorId && params.parentAuthorId !== params.authorId) {
    targets.add(params.parentAuthorId);
  }
  const snippet = params.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 280);
  for (const userId of targets) {
    await enqueueStandinJob({
      databases: params.databases,
      userId,
      trigger: mentioned.includes(userId) ? "mention" : "reply",
      triggerId: `${params.commentId}:${userId}`,
      taskId: params.taskId,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      commentId: params.commentId,
      snippet,
      actorUserId: params.authorId,
      actorName: params.authorName,
    });
  }
}

export async function maybeEnqueueStandinFromAssignment(params: {
  databases: Databases;
  actorUserId: string;
  actorName?: string;
  workItem: { $id?: string; id?: string; title?: string; projectId?: string; workspaceId?: string };
  assigneeIds: string[];
}): Promise<void> {
  if (isFairlxAgentAssignee(params.assigneeIds)) return;
  const taskId = String(params.workItem.$id || params.workItem.id || "");
  const workspaceId = String(params.workItem.workspaceId || "");
  if (!taskId || !workspaceId) return;
  for (const assigneeId of params.assigneeIds) {
    const userId = await resolveMemberUserId(params.databases, assigneeId);
    if (!userId || userId === params.actorUserId) continue;
    await enqueueStandinJob({
      databases: params.databases,
      userId,
      trigger: "assignment",
      triggerId: `assign:${taskId}:${userId}`,
      taskId,
      workspaceId,
      projectId: params.workItem.projectId,
      snippet: params.workItem.title ? `Assigned: ${params.workItem.title}` : "You were assigned a work item.",
      actorUserId: params.actorUserId,
      actorName: params.actorName,
    });
  }
}

export async function cancelStandinJobsForUserTask(params: {
  databases: Databases;
  userId: string;
  taskId: string;
}): Promise<void> {
  const jobs = await listStandinJobs(params.databases, {
    userId: params.userId,
    limit: 40,
  });
  for (const job of jobs) {
    if (asPayload(job).taskId !== params.taskId) continue;
    if (job.status === "scheduled" || job.status === "running" || job.result?.outcome === "awaiting_approval") {
      await updateAgentJob(params.databases, job.id, {
        status: "cancelled",
        result: { ...(job.result ?? {}), outcome: "cancelled_user_replied" },
      });
    }
  }
}

async function enqueueStandinJob(params: {
  databases: Databases;
  userId: string;
  trigger: StandinTrigger;
  triggerId: string;
  taskId: string;
  workspaceId: string;
  projectId?: string;
  commentId?: string;
  snippet: string;
  actorUserId?: string;
  actorName?: string;
}): Promise<void> {
  const profile = await getPersonalAgent(params.databases, params.userId);
  if (!profileIsTrained(profile)) return;
  const existing = await listStandinJobs(params.databases, { userId: params.userId, status: "scheduled", limit: 40 });
  if (existing.some((job) => asPayload(job).triggerId === params.triggerId)) return;
  let userName = profile?.answers.find((item) => item.questionId === "title_mandate")?.answer;
  try {
    const { users } = await createAdminClient();
    const user = await users.get(params.userId);
    userName = user.name || user.email || userName;
  } catch {
    /* keep fallback */
  }
  await createAgentJob(params.databases, {
    userId: params.userId,
    kind: "personal_standin",
    status: "scheduled",
    payload: {
      trigger: params.trigger,
      triggerId: params.triggerId,
      taskId: params.taskId,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      commentId: params.commentId,
      snippet: params.snippet,
      runAt: new Date(Date.now() + STANDIN_WAIT_MS).toISOString(),
      userName,
      actorUserId: params.actorUserId,
      actorName: params.actorName,
    } satisfies StandinPayload,
  });
}

async function userRepliedSince(params: {
  databases: Databases;
  userId: string;
  taskId: string;
  since: string;
}): Promise<boolean> {
  try {
    const comments = await params.databases.listDocuments(DATABASE_ID, COMMENTS_ID, [
      Query.equal("taskId", params.taskId),
      Query.orderDesc("$createdAt"),
      Query.limit(40),
    ]);
    const since = new Date(params.since).getTime();
    return comments.documents.some((doc) => {
      const authorId = String((doc as { authorId?: string }).authorId || "");
      const created = new Date(String(doc.$createdAt)).getTime();
      return authorId === params.userId && created >= since;
    });
  } catch {
    return false;
  }
}

async function countRecentAutoPosts(databases: Databases, userId: string): Promise<number> {
  const jobs = await listStandinJobs(databases, { userId, status: "completed", limit: 40 });
  const cutoff = Date.now() - 60 * 60 * 1000;
  return jobs.filter((job) => {
    if (job.result?.outcome !== "posted" || job.result?.auto !== true) return false;
    return new Date(job.updatedAt).getTime() >= cutoff;
  }).length;
}

function parseClassifierJson(raw: string): { class: StandinClass; draft: string; reason: string } | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed) as { class?: unknown; draft?: unknown; reason?: unknown };
    const classified = parsed.class === "routine" || parsed.class === "needs_you" ? parsed.class : null;
    const draft = typeof parsed.draft === "string" ? parsed.draft.trim() : "";
    if (!classified || !draft) return null;
    return { class: classified, draft, reason: typeof parsed.reason === "string" ? parsed.reason : "" };
  } catch {
    return null;
  }
}

export async function classifyStandinReply(params: {
  databases: Databases;
  userId: string;
  profile: PersonalAgentProfile;
  payload: StandinPayload;
  thread: string;
}): Promise<{ class: StandinClass; draft: string; reason: string }> {
  const fallbackDraft =
    params.payload.trigger === "assignment"
      ? "Thanks — I’ll look at this and follow up shortly."
      : "Thanks for the ping. I’ll take a look and reply with a proper update.";
  const fallback = { class: "needs_you" as const, draft: fallbackDraft, reason: "Defaulted to needing the human." };
  try {
    const aiDoc = await getAiDocument(params.databases, params.userId);
    const stored = mergePlatformAiConfig(aiDoc ? parseAiConfig(aiDoc) : defaultAiStoredConfig());
    const raw = await completePlainText({
      stored,
      maxTokens: 700,
      system: `You write a short comment in this user's voice for their Personal Agent stand-in.
Return JSON only: {"class":"routine"|"needs_you","draft":"...","reason":"..."}.
class=routine only for status, clarification already in the thread, or a factual question the standing prompt can answer without commitments.
class=needs_you for estimates, dates, assignments, blame, leadership, production, or anything the never-do list covers.
draft: 1-4 sentences, first person as the user, no @mentions, no apology spam.`,
      user: [
        `User: ${params.payload.userName || "this user"}`,
        `Trigger: ${params.payload.trigger}`,
        `Snippet: ${params.payload.snippet}`,
        "",
        "Standing prompt (excerpt):",
        params.profile.compiledPrompt.slice(0, 4000),
        "",
        "Thread:",
        params.thread.slice(0, 4000),
      ].join("\n"),
    });
    const parsed = parseClassifierJson(raw);
    if (!parsed) return fallback;
    if (parsed.class === "routine" && shouldForceNeedsYou(parsed.draft, params.profile.answers)) {
      return { ...parsed, class: "needs_you", reason: parsed.reason || "Safety overlay required the human." };
    }
    return parsed;
  } catch (error) {
    console.error("[personal-standin] classify failed", error);
    return fallback;
  }
}

async function loadThread(databases: Databases, taskId: string, title?: string): Promise<string> {
  try {
    const comments = await databases.listDocuments(DATABASE_ID, COMMENTS_ID, [
      Query.equal("taskId", taskId),
      Query.orderAsc("$createdAt"),
      Query.limit(30),
    ]);
    const lines = comments.documents.map((doc) => {
      const author = String((doc as { authorId?: string }).authorId || "someone");
      const text = String((doc as { content?: string }).content || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280);
      return `${author}: ${text}`;
    });
    return [`Work item: ${title || taskId}`, ...lines].join("\n");
  } catch {
    return `Work item: ${title || taskId}`;
  }
}

async function postLabeledComment(params: {
  databases: Databases;
  payload: StandinPayload;
  userName: string;
  draft: string;
}): Promise<string | null> {
  if (!COMMENTS_ID) return null;
  const body = standinCommentBody(params.userName, params.draft);
  const doc = await params.databases.createDocument(DATABASE_ID, COMMENTS_ID, ID.unique(), {
    content: body,
    taskId: params.payload.taskId,
    workspaceId: params.payload.workspaceId,
    projectId: params.payload.projectId || "",
    authorId: PERSONAL_STANDIN_AUTHOR_ID,
    isEdited: false,
    ...(params.payload.commentId ? { parentId: params.payload.commentId } : {}),
  });
  return doc.$id;
}

async function sendApprovalEmail(params: {
  userId: string;
  jobId: string;
  payload: StandinPayload;
  draft: string;
  reason: string;
}): Promise<void> {
  const { messaging, users, databases } = await createAdminClient();
  const user = await users.get(params.userId);
  if (!user.email) return;
  let taskName = params.payload.snippet;
  try {
    const task = await databases.getDocument(DATABASE_ID, TASKS_ID, params.payload.taskId);
    taskName = String((task as { title?: string; name?: string }).title || (task as { name?: string }).name || taskName);
  } catch {
    /* keep snippet */
  }
  const origin = appOrigin();
  const approveUrl = `${origin}/api/agent/personal/standin/${params.jobId}/approve?token=${signStandinToken(params.jobId, "approve")}`;
  const selfUrl = `${origin}/api/agent/personal/standin/${params.jobId}/self?token=${signStandinToken(params.jobId, "self")}`;
  const taskUrl = `${origin}/workspaces/${params.payload.workspaceId}/tasks/${params.payload.taskId}`;
  const html = standinApprovalTemplate({
    userName: params.payload.userName || user.name || "there",
    actorName: params.payload.actorName || "A teammate",
    taskName,
    draft: params.draft,
    reason: params.reason,
    trigger: params.payload.trigger,
    approveUrl,
    selfUrl,
    taskUrl,
  });
  await messaging.createEmail(
    ID.unique(),
    `Approve a reply on ${taskName}`,
    html,
    [],
    [params.userId],
    [],
    [],
    [],
    [],
    false,
    true,
  );
}

export async function processStandinJob(databases: Databases, job: AgentJob): Promise<AgentJob | null> {
  if (job.kind !== "personal_standin") return job;
  if (job.status === "cancelled" || job.status === "completed" || job.status === "failed") return job;
  const payload = asPayload(job);
  const runAt = new Date(payload.runAt).getTime();
  if (Number.isFinite(runAt) && runAt > Date.now()) return job;

  await updateAgentJob(databases, job.id, { status: "running", progress: { step: "Checking thread", percent: 20 } });

  if (await userRepliedSince({ databases, userId: job.userId, taskId: payload.taskId, since: job.createdAt })) {
    return updateAgentJob(databases, job.id, {
      status: "cancelled",
      result: { outcome: "cancelled_user_replied" },
      progress: { step: "Cancelled", percent: 100 },
    });
  }

  const profile = await getPersonalAgent(databases, job.userId);
  if (!profileIsTrained(profile) || !profile) {
    return updateAgentJob(databases, job.id, {
      status: "cancelled",
      result: { outcome: "skipped_untrained" },
      error: "Personal Agent is not trained.",
    });
  }

  let taskTitle = payload.snippet;
  try {
    const task = await databases.getDocument(DATABASE_ID, TASKS_ID, payload.taskId);
    taskTitle = String((task as { title?: string; name?: string }).title || (task as { name?: string }).name || taskTitle);
  } catch {
    /* ignore */
  }
  const thread = await loadThread(databases, payload.taskId, taskTitle);
  const classified = await classifyStandinReply({
    databases,
    userId: job.userId,
    profile,
    payload,
    thread,
  });
  const userName = payload.userName || "you";
  const recent = await countRecentAutoPosts(databases, job.userId);
  const canAuto = classified.class === "routine" && recent < STANDIN_AUTO_POST_PER_HOUR;

  if (canAuto) {
    const commentId = await postLabeledComment({ databases, payload, userName, draft: classified.draft });
    return updateAgentJob(databases, job.id, {
      status: "completed",
      progress: { step: "Posted", percent: 100 },
      result: {
        outcome: "posted",
        auto: true,
        class: classified.class,
        draft: classified.draft,
        reason: classified.reason,
        commentId,
      },
    });
  }

  try {
    await sendApprovalEmail({
      userId: job.userId,
      jobId: job.id,
      payload,
      draft: classified.draft,
      reason: classified.reason,
    });
  } catch (error) {
    console.error("[personal-standin] approval email failed", error);
  }

  return updateAgentJob(databases, job.id, {
    status: "completed",
    progress: { step: "Waiting for approval", percent: 80 },
    payload: {
      ...payload,
      tokenExpiresAt: new Date(Date.now() + STANDIN_TOKEN_TTL_MS).toISOString(),
    },
    result: {
      outcome: "awaiting_approval",
      auto: false,
      class: "needs_you",
      draft: classified.draft,
      reason: classified.reason,
      rateLimited: classified.class === "routine",
    },
  });
}

export async function processDueStandinJobs(databases: Databases): Promise<{ processed: number; skipped: number }> {
  const jobs = await listStandinJobs(databases, { status: "scheduled", limit: 40 });
  let processed = 0;
  let skipped = 0;
  for (const job of jobs) {
    const runAt = new Date(asPayload(job).runAt).getTime();
    if (Number.isFinite(runAt) && runAt > Date.now()) {
      skipped += 1;
      continue;
    }
    try {
      await processStandinJob(databases, job);
      processed += 1;
    } catch (error) {
      console.error("[personal-standin] job failed", job.id, error);
      await updateAgentJob(databases, job.id, {
        status: "failed",
        error: error instanceof Error ? error.message : "Stand-in job failed",
      });
    }
  }
  return { processed, skipped };
}

export async function resolveStandinDecision(params: {
  databases: Databases;
  jobId: string;
  action: "approve" | "self";
  token?: string;
  userId?: string;
}): Promise<{ ok: boolean; message: string; taskUrl?: string; status?: number }> {
  const job = await getAgentJobById(params.databases, params.jobId);
  if (!job || job.kind !== "personal_standin") {
    return { ok: false, message: "This stand-in request was not found.", status: 404 };
  }
  const payload = asPayload(job);
  const taskUrl = `${appOrigin()}/workspaces/${payload.workspaceId}/tasks/${payload.taskId}`;
  const tokenOk = Boolean(params.token && verifyStandinToken(job.id, params.action, params.token));
  const ownerOk = Boolean(params.userId && params.userId === job.userId);
  if (!tokenOk && !ownerOk) {
    return { ok: false, message: "This approval link is invalid.", status: 403, taskUrl };
  }
  const expires = typeof job.payload.tokenExpiresAt === "string" ? Date.now() > new Date(job.payload.tokenExpiresAt).getTime() : false;
  if (expires) {
    return { ok: false, message: "This approval link has expired.", status: 410, taskUrl };
  }
  if (job.result?.outcome === "posted") {
    return { ok: true, message: "That reply was already posted.", taskUrl };
  }
  if (job.result?.outcome === "self" || job.status === "cancelled") {
    return { ok: true, message: "You chose to answer this yourself.", taskUrl };
  }
  if (await userRepliedSince({ databases: params.databases, userId: job.userId, taskId: payload.taskId, since: job.createdAt })) {
    await updateAgentJob(params.databases, job.id, {
      status: "cancelled",
      result: { ...(job.result ?? {}), outcome: "cancelled_user_replied" },
    });
    return { ok: true, message: "You already replied in Fairlx, so nothing was posted.", taskUrl };
  }
  if (params.action === "self") {
    await updateAgentJob(params.databases, job.id, {
      status: "completed",
      result: { ...(job.result ?? {}), outcome: "self" },
      progress: { step: "You will answer", percent: 100 },
    });
    return { ok: true, message: "Okay — answer it in Fairlx when you can.", taskUrl };
  }
  const draft = typeof job.result?.draft === "string" ? job.result.draft : "";
  if (!draft.trim()) {
    return { ok: false, message: "There is no draft to post.", status: 409, taskUrl };
  }
  const commentId = await postLabeledComment({
    databases: params.databases,
    payload,
    userName: payload.userName || "you",
    draft,
  });
  await updateAgentJob(params.databases, job.id, {
    status: "completed",
    result: { ...(job.result ?? {}), outcome: "posted", auto: false, commentId },
    progress: { step: "Posted", percent: 100 },
  });
  return { ok: true, message: "Posted on your behalf.", taskUrl };
}

export function pendingStandinFromJobs(jobs: AgentJob[]): Array<{
  id: string;
  taskId: string;
  workspaceId: string;
  draft: string;
  reason: string;
  trigger: string;
}> {
  return jobs
    .filter((job) => job.result?.outcome === "awaiting_approval")
    .map((job) => {
      const payload = asPayload(job);
      return {
        id: job.id,
        taskId: payload.taskId,
        workspaceId: payload.workspaceId,
        draft: typeof job.result?.draft === "string" ? job.result.draft : "",
        reason: typeof job.result?.reason === "string" ? job.result.reason : "",
        trigger: payload.trigger,
      };
    });
}
