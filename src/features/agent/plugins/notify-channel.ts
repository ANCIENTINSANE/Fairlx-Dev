import { ID, Query, type Databases } from "node-appwrite";

import { DATABASE_ID, NOTIFICATIONS_ID, PROJECT_INTEGRATIONS_ID } from "@/config";
import type { ProjectIntegration } from "@/features/integrations/types";
import { decryptIntegrationToken } from "@/features/integrations/lib/helpers";

import { postSlackMessage, slackIntegrationForProject, slackIntegrationForWorkspace } from "./slack";

export type NotifyChannelKind = "slack" | "discord" | "teams" | "in_app" | "auto";

export type NotifyChannelInput = {
  channel?: NotifyChannelKind | string;
  target?: string;
  message: string;
  threadTs?: string;
  projectId?: string;
  workspaceId?: string;
  /** Fallback recipient for in_app when target is empty. */
  fallbackUserId?: string;
  workItemId?: string;
  runId?: string;
};

export type NotifyChannelResult = {
  ok: boolean;
  channel: NotifyChannelKind;
  delivered: string[];
  error?: string;
};

async function integrationFor(
  databases: Databases,
  provider: "discord" | "teams",
  projectId?: string,
  workspaceId?: string,
): Promise<ProjectIntegration | null> {
  const queries = [Query.equal("provider", provider), Query.limit(1)];
  if (projectId) {
    const byProject = await databases.listDocuments<ProjectIntegration>(DATABASE_ID, PROJECT_INTEGRATIONS_ID, [
      Query.equal("projectId", projectId),
      ...queries,
    ]);
    if (byProject.documents[0]) return byProject.documents[0];
  }
  if (workspaceId) {
    const byWorkspace = await databases.listDocuments<ProjectIntegration>(DATABASE_ID, PROJECT_INTEGRATIONS_ID, [
      Query.equal("workspaceId", workspaceId),
      ...queries,
    ]);
    if (byWorkspace.documents[0]) return byWorkspace.documents[0];
  }
  return null;
}

export async function notifyInApp(
  databases: Databases,
  params: { userId: string; title: string; message: string; workspaceId?: string; workItemId?: string; runId?: string },
): Promise<boolean> {
  if (!params.userId || !NOTIFICATIONS_ID) return false;
  let stored = false;
  try {
    await databases.createDocument(
      DATABASE_ID,
      NOTIFICATIONS_ID,
      ID.unique(),
      {
        userId: params.userId,
        type: "task_updated",
        title: params.title.slice(0, 200),
        message: params.message.slice(0, 1000),
        taskId: params.workItemId || "",
        workspaceId: params.workspaceId || "",
        triggeredBy: "fairlx-agent",
        metadata: JSON.stringify({ runId: params.runId, kind: "automation" }),
        isRead: false,
      },
      [`read("user:${params.userId}")`, `update("user:${params.userId}")`, `delete("user:${params.userId}")`],
    );
    stored = true;
  } catch {
    stored = false;
  }
  try {
    const secret = process.env.SOCKET_PUSH_SECRET;
    if (secret) {
      await fetch(`http://localhost:${process.env.PORT || 3000}/internal/socket-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: params.userId,
          secret,
          payload: {
            notificationId: crypto.randomUUID(),
            type: "WORKITEM_UPDATED",
            title: params.title,
            message: params.message,
            workitemId: params.workItemId,
            workspaceId: params.workspaceId,
            createdAt: new Date().toISOString(),
            triggeredBy: "fairlx-agent",
          },
        }),
      });
    }
  } catch {
    /* socket bridge optional */
  }
  return stored;
}

/**
 * One entry point for "tell people": Slack (bot token, thread-aware), Discord (webhook),
 * Teams (incoming webhook), or a Fairlx in-app notification. `auto` picks the first connected chat
 * channel and falls back to in-app.
 */
export async function notifyChannel(databases: Databases, input: NotifyChannelInput): Promise<NotifyChannelResult> {
  const requested = (String(input.channel || "auto").toLowerCase() as NotifyChannelKind) || "auto";
  const message = input.message.trim();
  if (!message) return { ok: false, channel: requested, delivered: [], error: "Empty message." };
  const target = (input.target || "").trim();
  const delivered: string[] = [];

  const trySlack = async (): Promise<string | null> => {
    const slack =
      (input.projectId ? await slackIntegrationForProject(databases, input.projectId) : null) ??
      (input.workspaceId ? await slackIntegrationForWorkspace(databases, input.workspaceId) : null);
    if (!slack?.enabled || !slack.token) return "Slack is not connected for this project.";
    const channel = target && (target.startsWith("#") || /^[CGD][A-Z0-9]{6,}$/.test(target)) ? target : slack.channelId || "";
    if (!channel) return "Slack has no default channel. Pass target: \"#channel\" or set one in Integrations.";
    const posted = await postSlackMessage({ token: slack.token, channel, text: message, threadTs: input.threadTs });
    if (!posted.ok) return `Slack: ${posted.error || "post failed"}`;
    delivered.push(`slack:${channel}`);
    return null;
  };

  const tryDiscord = async (): Promise<string | null> => {
    const discord = await integrationFor(databases, "discord", input.projectId, input.workspaceId);
    const url = target.startsWith("https://") ? target : discord?.webhookUrl || "";
    if (!discord?.enabled || !url) return "Discord is not connected for this project.";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message.slice(0, 1900) }),
    });
    if (!response.ok) return `Discord webhook ${response.status}`;
    delivered.push("discord");
    return null;
  };

  const tryTeams = async (): Promise<string | null> => {
    const teams = await integrationFor(databases, "teams", input.projectId, input.workspaceId);
    const url = target.startsWith("https://") ? target : teams?.webhookUrl || decryptIntegrationToken(teams?.accessToken) || "";
    if (!teams?.enabled || !url) return "Microsoft Teams is not connected for this project.";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!response.ok) return `Teams webhook ${response.status}`;
    delivered.push("teams");
    return null;
  };

  const tryInApp = async (): Promise<string | null> => {
    const userId = target && !target.startsWith("#") && !target.includes("@") ? target : input.fallbackUserId || "";
    if (!userId) return "No Fairlx user to notify.";
    const ok = await notifyInApp(databases, {
      userId,
      title: "Fairlx update",
      message,
      workspaceId: input.workspaceId,
      workItemId: input.workItemId,
      runId: input.runId,
    });
    if (!ok) return "Could not store the in-app notification.";
    delivered.push(`in_app:${userId}`);
    return null;
  };

  const errors: string[] = [];
  const run = async (kind: NotifyChannelKind) => {
    const error =
      kind === "slack" ? await trySlack() : kind === "discord" ? await tryDiscord() : kind === "teams" ? await tryTeams() : await tryInApp();
    if (error) errors.push(error);
    return !error;
  };

  if (requested === "auto") {
    for (const kind of ["slack", "discord", "teams", "in_app"] as NotifyChannelKind[]) {
      if (await run(kind)) return { ok: true, channel: kind, delivered };
    }
    return { ok: false, channel: "auto", delivered, error: errors.join(" ") };
  }
  const ok = await run(requested);
  return { ok, channel: requested, delivered, error: ok ? undefined : errors.join(" ") };
}
