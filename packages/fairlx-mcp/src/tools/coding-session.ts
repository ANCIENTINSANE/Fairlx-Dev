import { invalidParams, notFoundError } from "../protocol/errors";
import type { McpToolResult } from "../protocol/types";
import type { AuthContext } from "../auth/context";
import { PERMISSIONS, type McpRuntime } from "../runtime/types";
import { toolResult, withId } from "../runtime/output";
import { requireProjectAccess } from "../runtime/rbac";
import { loadWorkItem, workItemDocumentId } from "../runtime/tenant";
import { optionalString, requireString } from "./helpers";

function collectionId(runtime: McpRuntime): string | undefined {
  return runtime.collections.codingSessions;
}

function mentionsFairlx(text: string): boolean {
  return /@fairlx\b/i.test(text.replace(/<[^>]+>/g, " "));
}

function isFairlxAgentAssignee(ids: string[]): boolean {
  const known = new Set(
    [process.env.FAIRLX_AGENT_USER_ID, process.env.FAIRLX_AGENT_MEMBER_ID, "fairlx-agent"]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
  return ids.some((id) => known.has(id.toLowerCase()));
}

export function shouldQueueCodingSession(assigneeIds: string[]): boolean {
  return isFairlxAgentAssignee(assigneeIds);
}

async function requireSessions(runtime: McpRuntime): Promise<string> {
  const id = collectionId(runtime);
  if (!id) throw invalidParams("Coding sessions are not provisioned. Run db:setup:agent.");
  return id;
}

function parseEvents(raw: unknown): Array<Record<string, unknown>> {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

export async function handleCodingSessionTool(
  name: string,
  args: Record<string, unknown>,
  runtime: McpRuntime,
  auth: AuthContext,
): Promise<McpToolResult> {
  const sessions = await requireSessions(runtime);
  if (name === "fairlx_coding_session_status") {
    const sessionId = optionalString(args, "sessionId");
    const workItemId = optionalString(args, "workItemId");
    let doc: Record<string, unknown> | undefined;
    if (sessionId) {
      try {
        doc = await runtime.store.get<Record<string, unknown>>(sessions, sessionId);
      } catch {
        throw notFoundError("Coding session not found");
      }
    } else if (workItemId) {
      const item = await loadWorkItem(runtime, auth, workItemId);
      await requireProjectAccess(runtime, auth, String(item.projectId), PERMISSIONS.VIEW_TASKS, ["tasks:read"]);
      const listed = await runtime.store.list<Record<string, unknown>>(sessions, [
        { type: "equal", field: "workItemId", value: workItemDocumentId(item) },
        { type: "orderDesc", field: "$createdAt" },
        { type: "limit", value: 1 },
      ]);
      doc = listed.documents[0];
    }
    if (!doc) throw notFoundError("Coding session not found");
    await requireProjectAccess(runtime, auth, String(doc.projectId), PERMISSIONS.VIEW_TASKS, ["tasks:read"]);
    return toolResult({ session: withId(doc) });
  }

  if (name === "fairlx_coding_session_start") {
    const workItemId = requireString(args, "workItemId");
    const item = await loadWorkItem(runtime, auth, workItemId);
    await requireProjectAccess(runtime, auth, String(item.projectId), PERMISSIONS.EDIT_TASKS, ["tasks:write"]);
    const documentId = workItemDocumentId(item);
    const existing = await runtime.store.list<Record<string, unknown>>(sessions, [
      { type: "equal", field: "workItemId", value: documentId },
      { type: "orderDesc", field: "$createdAt" },
      { type: "limit", value: 5 },
    ]);
    const active = existing.documents.find(
      (session) => !["merged", "failed", "stopped"].includes(String(session.status || "")),
    );
    if (active) {
      return toolResult({ session: withId(active), resumed: true });
    }
    const created = await runtime.store.create<Record<string, unknown>>(sessions, {
      userId: auth.actorUserId,
      workItemId: documentId,
      projectId: item.projectId,
      workspaceId: item.workspaceId,
      runId: "",
      repoId: "",
      baseBranch: optionalString(args, "baseBranch") || "main",
      headBranch: `fairlx/${String(item.key || documentId).toLowerCase()}`,
      status: "queued",
      sandboxId: "",
      previewUrl: "",
      prNumber: "",
      prUrl: "",
      orchestratorModelId: "",
      workerModelId: "deepseek-pro",
      eventsJson: JSON.stringify([
        {
          id: crypto.randomUUID(),
          type: "queued",
          detail: "Queued from Fairlx MCP. Open Fairlx Agent or wait for the sandbox job.",
          createdAt: new Date().toISOString(),
        },
      ]),
    });
    return toolResult({
      session: withId(created),
      next: "Open Fairlx Agent on this work item, or call coding_session_start in the in-app agent so Azure clones the repo.",
    });
  }

  if (name === "fairlx_coding_session_comment") {
    const sessionId = requireString(args, "sessionId");
    const body = requireString(args, "body");
    const path = optionalString(args, "path") || "";
    const line = typeof args.line === "number" ? args.line : undefined;
    let doc: Record<string, unknown>;
    try {
      doc = await runtime.store.get<Record<string, unknown>>(sessions, sessionId);
    } catch {
      throw notFoundError("Coding session not found");
    }
    await requireProjectAccess(runtime, auth, String(doc.projectId), PERMISSIONS.CREATE_COMMENTS, ["comments:write"]);
    const events = parseEvents(doc.eventsJson);
    events.push({
      id: crypto.randomUUID(),
      type: "hunk_comment",
      detail: `${path}${line != null ? `:${line}` : ""} ${body}`,
      createdAt: new Date().toISOString(),
    });
    const updated = await runtime.store.update<Record<string, unknown>>(sessions, sessionId, {
      status: "iterating",
      eventsJson: JSON.stringify(events.slice(-80)),
    });
    return toolResult({ session: withId(updated), mention: mentionsFairlx(body) });
  }

  if (name === "fairlx_coding_session_merge") {
    const sessionId = requireString(args, "sessionId");
    let doc: Record<string, unknown>;
    try {
      doc = await runtime.store.get<Record<string, unknown>>(sessions, sessionId);
    } catch {
      throw notFoundError("Coding session not found");
    }
    await requireProjectAccess(runtime, auth, String(doc.projectId), PERMISSIONS.EDIT_TASKS, ["tasks:write"]);
    const events = parseEvents(doc.eventsJson);
    events.push({
      id: crypto.randomUUID(),
      type: "merge_requested",
      detail: "Merge requested from MCP. Completes after Accept in Fairlx Agent unless all_access.",
      createdAt: new Date().toISOString(),
    });
    const updated = await runtime.store.update<Record<string, unknown>>(sessions, sessionId, {
      status: "merging",
      eventsJson: JSON.stringify(events.slice(-80)),
    });
    return toolResult({
      session: withId(updated),
      next: "Accept github_merge_pr in Fairlx Agent (staged permission) or use all_access.",
    });
  }

  throw invalidParams(`Unknown coding session tool: ${name}`);
}

export async function maybeQueueFromWorkItemUpdate(
  runtime: McpRuntime,
  auth: AuthContext,
  item: Record<string, unknown>,
  assigneeIds?: string[],
  status?: string,
): Promise<void> {
  try {
    if (assigneeIds && shouldQueueCodingSession(assigneeIds)) {
      await handleCodingSessionTool(
        "fairlx_coding_session_start",
        { workItemId: String(item.key || item.$id) },
        runtime,
        auth,
      );
    }
    const triage = process.env.FAIRLX_CODING_TRIAGE_STATUS?.trim();
    if (triage && status && status.toLowerCase() === triage.toLowerCase()) {
      await handleCodingSessionTool(
        "fairlx_coding_session_start",
        { workItemId: String(item.key || item.$id) },
        runtime,
        auth,
      );
    }
  } catch {
    // Session collection may be missing in tests.
  }
}

export async function maybeCommentMention(
  runtime: McpRuntime,
  auth: AuthContext,
  workItemId: string,
  content: string,
): Promise<void> {
  if (!mentionsFairlx(content) || !collectionId(runtime)) return;
  try {
    const result = await handleCodingSessionTool(
      "fairlx_coding_session_status",
      { workItemId },
      runtime,
      auth,
    );
    const text = result.content.find((block) => block.type === "text")?.text;
    let sessionId: string | undefined;
    if (text) {
      try {
        sessionId = (JSON.parse(text) as { session?: { id?: string } }).session?.id;
      } catch {
        sessionId = undefined;
      }
    }
    if (sessionId) {
      await handleCodingSessionTool(
        "fairlx_coding_session_comment",
        { sessionId, body: content },
        runtime,
        auth,
      );
    }
  } catch {
    // ignore
  }
}
