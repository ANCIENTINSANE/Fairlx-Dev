import type { Databases } from "node-appwrite";

import { extractWorkItemKey, parseFairlxMention } from "./mentions";
import { maybeAttachFairlxMention, maybeStartSessionFromAssignees } from "./coding-session-hooks";
import { findActiveCodingSessionForWorkItem } from "./coding-sessions";
import { DATABASE_ID, WORK_ITEMS_ID } from "@/config";
import { Query } from "node-appwrite";

export type InboundMentionSource = "slack" | "discord" | "teams" | "whatsapp" | "comment";

export type InboundMentionResult = {
  ok: boolean;
  auto: boolean;
  workItemId?: string;
  runId?: string;
  error?: string;
};

async function resolveWorkItem(
  databases: Databases,
  params: { projectId?: string; workItemId?: string; text: string },
): Promise<{ $id: string; key?: string; title?: string; projectId?: string; workspaceId?: string } | null> {
  if (params.workItemId) {
    try {
      return (await databases.getDocument(DATABASE_ID, WORK_ITEMS_ID, params.workItemId)) as never;
    } catch {
      return null;
    }
  }
  const key = extractWorkItemKey(params.text);
  if (!key) return null;
  const queries = [Query.equal("key", key), Query.limit(1)];
  if (params.projectId) queries.unshift(Query.equal("projectId", params.projectId));
  try {
    const listed = await databases.listDocuments(DATABASE_ID, WORK_ITEMS_ID, queries);
    return (listed.documents[0] as never) ?? null;
  } catch {
    return null;
  }
}

export async function handleInboundFairlxMention(params: {
  databases: Databases;
  source: InboundMentionSource;
  text: string;
  userId: string;
  projectId?: string;
  workspaceId?: string;
  workItemId?: string;
  user?: { $id: string; name?: string; email?: string };
}): Promise<InboundMentionResult> {
  const mention = parseFairlxMention(params.text);
  if (!mention) return { ok: false, auto: false, error: "No @Fairlx mention" };
  const auto = mention === "fairlx-auto";
  const item = await resolveWorkItem(params.databases, {
    projectId: params.projectId,
    workItemId: params.workItemId,
    text: params.text,
  });
  if (!item?.$id) {
    return { ok: false, auto, error: "No linked work item. Include a key like WEB-12." };
  }
  const existing = await findActiveCodingSessionForWorkItem(params.databases, item.$id);
  if (existing?.runId) {
    await maybeAttachFairlxMention({
      databases: params.databases,
      userId: params.userId,
      workItemId: item.$id,
      content: params.text,
    });
    return { ok: true, auto, workItemId: item.$id, runId: existing.runId };
  }
  await maybeStartSessionFromAssignees({
    databases: params.databases,
    userId: params.userId,
    workItem: item,
    assigneeIds: ["fairlx-agent"],
    user: params.user,
    autoMode: auto,
  });
  const started = await findActiveCodingSessionForWorkItem(params.databases, item.$id);
  return { ok: true, auto, workItemId: item.$id, runId: started?.runId };
}

export { extractDiscordInteractionText } from "./mentions";
