import type {
  AgentCapability,
  AgentContext,
  AgentPluginConnection,
  AgentPluginPublic,
  AgentToolEvent,
} from "../types";
import { linkedGithubRepos, hasGithubAccount, hasGithubRepoAccess } from "../lib/github-scope";

export type PluginCatalogAuth = "platform" | "oauth" | "token" | "mcp";

export type PluginCatalogItem = {
  id: string;
  name: string;
  description: string;
  capabilities: AgentCapability[];
  auth: PluginCatalogAuth;
  fields: Array<{
    key: string;
    label: string;
    secret?: boolean;
    placeholder?: string;
  }>;
};

export const PLUGIN_CATALOG: PluginCatalogItem[] = [
  {
    id: "fairlx",
    name: "Fairlx",
    description: "Work items, members, invites, and workflows in this workspace.",
    capabilities: ["members.invite"],
    auth: "platform",
    fields: [],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Sign in once for all Fairlx projects. Create repos, read files, commit, and open pull requests.",
    capabilities: ["code.read", "code.write", "security.review"],
    auth: "oauth",
    fields: [
      { key: "token", label: "Personal access token (repo + read:org)", secret: true, placeholder: "ghp_…" },
    ],
  },
  {
    id: "outlook",
    name: "Outlook / Microsoft 365",
    description: "Send mail with Microsoft Graph. Connect once; Fairlx refreshes the token.",
    capabilities: ["email.send"],
    auth: "oauth",
    fields: [
      { key: "from", label: "From address (optional)", placeholder: "you@company.com" },
      { key: "clientId", label: "Microsoft app client ID (if Fairlx OAuth is not configured)" },
      { key: "clientSecret", label: "Microsoft app client secret", secret: true },
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Send mail with the Gmail API. Connect once; Fairlx refreshes the token.",
    capabilities: ["email.send"],
    auth: "oauth",
    fields: [
      { key: "from", label: "From address (optional)", placeholder: "you@gmail.com" },
      { key: "clientId", label: "Google OAuth client ID (if Fairlx OAuth is not configured)" },
      { key: "clientSecret", label: "Google OAuth client secret", secret: true },
    ],
  },
  {
    id: "resend",
    name: "Resend / HTTP mail",
    description: "Send mail via Resend or a compatible JSON HTTP endpoint.",
    capabilities: ["email.send"],
    auth: "token",
    fields: [
      { key: "apiKey", label: "API key", secret: true },
      { key: "from", label: "From address", placeholder: "agent@yourdomain.com" },
      { key: "endpoint", label: "Endpoint (optional)", placeholder: "https://api.resend.com/emails" },
    ],
  },
  {
    id: "mail-mcp",
    name: "Mail MCP",
    description: "Remote HTTP MCP server that exposes a send-mail tool (Outlook MCP, etc.).",
    capabilities: ["email.send"],
    auth: "mcp",
    fields: [
      { key: "url", label: "MCP URL" },
      { key: "headerAuthorization", label: "Authorization header (optional)", secret: true },
      { key: "tool", label: "Tool name", placeholder: "send_email" },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Notify a channel. @Fairlx starts a coding session; @Fairlx-auto is autonomous.",
    capabilities: ["chat.notify"],
    auth: "oauth",
    fields: [{ key: "channelId", label: "Default channel id" }],
  },
  {
    id: "discord",
    name: "Discord",
    description: "Notify a Discord channel. Mentions share the same inbound coding-session pipeline as Slack.",
    capabilities: ["chat.notify"],
    auth: "token",
    fields: [
      { key: "url", label: "Webhook URL" },
      { key: "channelId", label: "Channel id" },
    ],
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    description: "Incoming webhook. @Fairlx / @Fairlx-auto start or resume a bound coding session.",
    capabilities: ["chat.notify"],
    auth: "token",
    fields: [{ key: "url", label: "Outgoing webhook URL (Fairlx: /api/integrations/teams/webhook)" }],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "WhatsApp Cloud API webhook. @Fairlx mentions start or resume a coding session.",
    capabilities: ["chat.notify"],
    auth: "token",
    fields: [{ key: "apiKey", label: "Cloud API token", secret: true }],
  },
  {
    id: "security",
    name: "Security review",
    description: "Isolated source review. Never exploits production. Shannon can plug in later behind the same interface.",
    capabilities: ["security.review"],
    auth: "platform",
    fields: [],
  },
];

export function catalogById(id: string): PluginCatalogItem | undefined {
  return PLUGIN_CATALOG.find((item) => item.id === id);
}

const EMAIL_LIKE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function isSendMailIntent(query: string): boolean {
  if (/\b(send|draft|compose)\b[\s\S]{0,80}\b(e-?mails?|mails?)\b/i.test(query)) return true;
  if (/\b(e-?mails?|mails?)\s+(the client|them|him|her|about)\b/i.test(query)) return true;
  if (/\b(connect|plugin)\b[\s\S]{0,40}\b(outlook|gmail|resend)\b/i.test(query)) return true;
  if (/\b(outlook|gmail|resend|smtp|inbox)\b/i.test(query) && !isOrgInviteIntent(query)) return true;
  return false;
}

export function isOrgInviteIntent(query: string): boolean {
  if (/\b(invite|join link|share link|add\b.{0,60}member)\b/i.test(query)) return true;
  if (/\b(add|invite|join)\b[\s\S]{0,160}\b(project|workspace|team|org|organization)\b/i.test(query)) return true;
  const identity =
    EMAIL_LIKE.test(query) || /\b(mail\s*id|e-?mail\s*(id|address)|e-?mail\s+is)\b/i.test(query);
  if (identity && /\b(add|invite|role|team|assign|project|member|workspace)\b/i.test(query)) return true;
  return false;
}

export function inferCapabilities(query: string): AgentCapability[] {
  const caps = new Set<AgentCapability>();
  if (isSendMailIntent(query)) caps.add("email.send");
  if (isOrgInviteIntent(query)) caps.add("members.invite");
  if (/\b(slack|discord|notify channel)\b/i.test(query)) caps.add("chat.notify");
  if (/\b(security|vulnerab|xss|ssrf|pentest|shannon|cve)\b/i.test(query)) caps.add("security.review");
  if (/\b(create|make|new)\b.{0,60}\b(github\s+)?repo(sitor(y|ies))?\b/i.test(query) || /\bgithub\b.{0,40}\b(create|new)\b.{0,40}\brepo/i.test(query)) {
    caps.add("code.write");
  }
  if (/\b(pr\b|pull request|commit|edit the code|open a pr|patch the repo)\b/i.test(query)) {
    caps.add("code.read");
    caps.add("code.write");
  } else if (/\b(repo|repository|read the (code|file)|github file)\b/i.test(query)) {
    caps.add("code.read");
  }
  return Array.from(caps);
}

export function pluginHasCapability(plugin: AgentPluginConnection, capability: AgentCapability): boolean {
  return plugin.status === "connected" && plugin.capabilities.includes(capability);
}

export function hasCapability(
  plugins: AgentPluginConnection[],
  context: AgentContext,
  capability: AgentCapability,
): boolean {
  if (capability === "members.invite") return true;
  if (capability === "chat.notify") {
    return context.integrations.some((item) => /slack|discord/i.test(item.provider ?? ""));
  }
  if (capability === "code.read" || capability === "security.review") {
    return linkedGithubRepos(context).length > 0 && hasGithubRepoAccess(context);
  }
  if (capability === "code.write") {
    return hasGithubAccount(context) || hasGithubRepoAccess(context);
  }
  return plugins.some((plugin) => pluginHasCapability(plugin, capability));
}

export function missingCapabilities(
  query: string,
  plugins: AgentPluginConnection[],
  context: AgentContext,
): AgentCapability[] {
  return inferCapabilities(query).filter((cap) => {
    if (isGithubCapability(cap) && hasGithubAccount(context)) return false;
    return !hasCapability(plugins, context, cap);
  });
}

export function isGithubCapability(capability: AgentCapability): boolean {
  return capability === "code.read" || capability === "code.write" || capability === "security.review";
}

export function catalogForCapability(capability: AgentCapability): PluginCatalogItem[] {
  return PLUGIN_CATALOG.filter(
    (item) =>
      item.capabilities.includes(capability) &&
      (item.auth !== "platform" || item.fields.length > 0),
  );
}

export function toPublicPlugin(plugin: AgentPluginConnection): AgentPluginPublic {
  return {
    id: plugin.id,
    catalogId: plugin.catalogId,
    displayName: plugin.displayName,
    capabilities: plugin.capabilities,
    status: plugin.status,
    authKind: plugin.authKind,
    hasSecret: Boolean(
      plugin.secrets?.accessTokenEncrypted ||
        plugin.secrets?.refreshTokenEncrypted ||
        plugin.secrets?.apiKeyEncrypted ||
        plugin.secrets?.mcpHeadersEncrypted,
    ),
    from: plugin.secrets?.from,
    mcpUrl: plugin.secrets?.mcpUrl,
    createdAt: plugin.createdAt,
  };
}

export type AgentPendingPlugin = {
  capability: AgentCapability;
  catalogIds: string[];
  summary: string;
};

export function pendingPluginFromEvent(event: AgentToolEvent | undefined): AgentPendingPlugin | undefined {
  if (!event || event.type !== "plugin_required") return undefined;
  const payload = event.payload;
  if (!payload || typeof payload !== "object") return undefined;
  const data = payload as Partial<AgentPendingPlugin>;
  if (!data.capability || !Array.isArray(data.catalogIds)) return undefined;
  return {
    capability: data.capability,
    catalogIds: data.catalogIds,
    summary: data.summary || `Connect a plugin for ${data.capability}.`,
  };
}

export function findPendingPlugin(events: AgentToolEvent[]): AgentPendingPlugin | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type === "plugin_required") return pendingPluginFromEvent(event);
    if (event.type === "plugin_connected") return undefined;
  }
  return undefined;
}
