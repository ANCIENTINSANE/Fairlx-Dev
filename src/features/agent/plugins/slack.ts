import { createHmac, timingSafeEqual } from "node:crypto";
import { Query, type Databases } from "node-appwrite";

import { DATABASE_ID, PROJECT_INTEGRATIONS_ID } from "@/config";
import type { ProjectIntegration } from "@/features/integrations/types";
import { decryptIntegrationToken } from "@/features/integrations/lib/helpers";

/**
 * Thin Slack Web API layer used by slash commands, thread replies, automation notifications,
 * and the supervisor node. Tokens come from the per-project Slack integration (OAuth).
 */

export type SlackIntegration = ProjectIntegration & { token: string | null };

function withToken(row?: ProjectIntegration | null): SlackIntegration | null {
  if (!row) return null;
  return { ...row, token: decryptIntegrationToken(row.accessToken) };
}

export async function slackIntegrationForTeam(databases: Databases, teamId: string): Promise<SlackIntegration | null> {
  if (!teamId) return null;
  const listed = await databases.listDocuments<ProjectIntegration>(DATABASE_ID, PROJECT_INTEGRATIONS_ID, [
    Query.equal("provider", "slack"),
    Query.equal("externalTeamId", teamId),
    Query.limit(1),
  ]);
  return withToken(listed.documents[0]);
}

export async function slackIntegrationForProject(databases: Databases, projectId: string): Promise<SlackIntegration | null> {
  if (!projectId) return null;
  const listed = await databases.listDocuments<ProjectIntegration>(DATABASE_ID, PROJECT_INTEGRATIONS_ID, [
    Query.equal("provider", "slack"),
    Query.equal("projectId", projectId),
    Query.limit(1),
  ]);
  return withToken(listed.documents[0]);
}

export async function slackIntegrationForWorkspace(databases: Databases, workspaceId: string): Promise<SlackIntegration | null> {
  if (!workspaceId) return null;
  const listed = await databases.listDocuments<ProjectIntegration>(DATABASE_ID, PROJECT_INTEGRATIONS_ID, [
    Query.equal("provider", "slack"),
    Query.equal("workspaceId", workspaceId),
    Query.limit(1),
  ]);
  return withToken(listed.documents[0]);
}

/**
 * Slack signs every request with `v0=HMAC-SHA256(signing_secret, "v0:" + timestamp + ":" + body)`.
 * Returns true when SLACK_SIGNING_SECRET is unset (dev) so local testing still works.
 */
export function verifySlackSignature(params: {
  rawBody: string;
  timestamp?: string | null;
  signature?: string | null;
  secret?: string;
  now?: number;
}): boolean {
  const secret = params.secret ?? process.env.SLACK_SIGNING_SECRET ?? "";
  if (!secret) return true;
  const timestamp = Number(params.timestamp || 0);
  if (!timestamp || Math.abs((params.now ?? Date.now()) / 1000 - timestamp) > 60 * 5) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${params.rawBody}`).digest("hex")}`;
  const given = String(params.signature || "");
  if (given.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  } catch {
    return false;
  }
}

type SlackApiResult<T> = { ok: boolean; error?: string } & T;

async function slackCall<T>(token: string, method: string, body: Record<string, unknown>): Promise<SlackApiResult<T>> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return (await response.json().catch(() => ({ ok: false, error: "invalid_json" }))) as SlackApiResult<T>;
}

async function slackGet<T>(token: string, method: string, query: Record<string, string>): Promise<SlackApiResult<T>> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return (await response.json().catch(() => ({ ok: false, error: "invalid_json" }))) as SlackApiResult<T>;
}

export async function postSlackMessage(params: {
  token: string;
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: unknown[];
}): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const result = await slackCall<{ ts?: string }>(params.token, "chat.postMessage", {
    channel: params.channel,
    text: params.text,
    ...(params.threadTs ? { thread_ts: params.threadTs } : {}),
    ...(params.blocks ? { blocks: params.blocks } : {}),
    unfurl_links: false,
  });
  return { ok: result.ok, ts: result.ts, error: result.error };
}

/** Reply to a slash command after the 3-second ack using its response_url. */
export async function respondToSlackCommand(responseUrl: string, text: string, inChannel = false): Promise<void> {
  if (!responseUrl) return;
  try {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_type: inChannel ? "in_channel" : "ephemeral", text }),
    });
  } catch {
    /* Slack response_url is best effort */
  }
}

export type SlackThreadMessage = { ts: string; text: string; user?: string; botId?: string };

/** Parent + replies of a thread. Needs `channels:history` / `groups:history` scopes. */
export async function fetchSlackThread(params: {
  token: string;
  channel: string;
  threadTs: string;
  limit?: number;
}): Promise<SlackThreadMessage[]> {
  const result = await slackGet<{ messages?: Array<{ ts: string; text?: string; user?: string; bot_id?: string }> }>(
    params.token,
    "conversations.replies",
    { channel: params.channel, ts: params.threadTs, limit: String(params.limit ?? 40) },
  );
  if (!result.ok || !result.messages) return [];
  return result.messages.map((message) => ({
    ts: message.ts,
    text: message.text || "",
    user: message.user,
    botId: message.bot_id,
  }));
}

export async function slackUserEmail(token: string, userId: string): Promise<{ email?: string; name?: string }> {
  if (!userId) return {};
  const result = await slackGet<{ user?: { real_name?: string; name?: string; profile?: { email?: string } } }>(
    token,
    "users.info",
    { user: userId },
  );
  if (!result.ok || !result.user) return {};
  return { email: result.user.profile?.email, name: result.user.real_name || result.user.name };
}

/** Strip <@U123> mentions and <url|label> markup Slack puts in message text. */
export function plainSlackText(text: string): string {
  return (text || "")
    .replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, " ")
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, "#$1")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Slack `text` in events contains `<@BOTID>`; treat that like @Fairlx. */
export function slackTextMentionsBot(text: string, botUserId?: string): boolean {
  if (!text) return false;
  if (botUserId && text.includes(`<@${botUserId}>`)) return true;
  return /@fairlx(?:-auto|_auto)?\b/i.test(text) || /<@[A-Z0-9]+>/.test(text);
}

export const SLACK_REQUIRED_BOT_SCOPES = [
  "commands",
  "chat:write",
  "chat:write.public",
  "app_mentions:read",
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "channels:read",
  "users:read",
  "users:read.email",
  "links:read",
  "links:write",
  "incoming-webhook",
] as const;

export const SLACK_EVENT_SUBSCRIPTIONS = ["app_mention", "message.channels", "message.groups", "message.im", "link_shared"] as const;
