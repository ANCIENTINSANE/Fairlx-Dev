import type { Databases } from "node-appwrite";
import type { AuthContext } from "@fairlx/mcp-server";

import type {
  AgentCapability,
  AgentContext,
  AgentHarness,
  AgentPermissionType,
  AgentPluginConnection,
  AgentRun,
  AgentSpecialistId,
  AgentToolEvent,
  AgentToolEventType,
  McpConfig,
} from "../types";
import { specialistById } from "./graph";
import { commitStaged, stageItem, unstageItem } from "./git-staging";
import { callMcpServerTool, ensurePersonalMcp, listMcpResourcesForServer, listMcpToolsForServer } from "./mcp-bridge";
import {
  DESTRUCTIVE_NOT_REQUESTED_MESSAGE,
  DESTRUCTIVE_REQUIRES_ACCEPT_MESSAGE,
  destructiveToolBlockReason,
  destructiveUserAccepted,
} from "./write-guard";
import { createFairlxProject } from "./mutations";
import { readPersonalContent } from "./personal";
import { compilePersonalPrompt, isPersonalPersonaRole } from "./personal-training";
import { upsertPersonalAgent } from "./personal-agent-store";
import { toPublicMcpConfig } from "./public-mcp";
import { matchingAutomations, searchAgentIndex } from "./search";
import { parsePageUiAction, pageUiEventTitle } from "./page-ui-action";
import { compactJsonString, unwrapMcpToolContent } from "./truncate";
import {
  MAX_PROJECT_DOCS_PER_TURN,
  docPackCompletePayload,
  emptyDocTurnLimits,
  hasRequiredWebResearch,
  noteWebResearch,
  releaseDocCreateSlot,
  researchRequiredPayload,
  reserveDocCreateSlot,
  reserveWebFetchSlot,
  webFetchCapPayload,
  type DocTurnLimits,
} from "./doc-turn-limits";
import { fetchPublicPage, searchPublicWeb } from "./web-research";
import { attachedSearchPayload, extractAttachedFiles } from "./attachments";
import { hasGithubAccount, hasProjectGithubRepo } from "./github-scope";
import { catalogForCapability, hasCapability, isGithubCapability, missingCapabilities } from "../plugins/catalog";
import { sendMailViaPlugin } from "../plugins/mail";
import { githubPauseCapability, parseGithubAttachRequest, parsePrFiles, githubSessionInspectBranch, githubSandboxInspectHint } from "../plugins/github-helpers";
import {
  githubAccountStatus,
  githubCloseIssue,
  githubCommentIssue,
  githubCommitFilesAndOpenPr,
  githubCreateIssue,
  githubCreateRepo,
  githubDeleteFile,
  githubLinkRepo,
  githubListAccountOwners,
  githubListAccountRepos,
  githubListBranches,
  githubListFiles,
  githubListIssues,
  githubListPullRequests,
  githubListReleases,
  githubMergePullRequest,
  githubOpenPullRequest,
  githubReadFile,
  githubRequestReviewers,
  githubUpdateRepo,
  githubWriteFile,
  resolveGithubRepo,
} from "../plugins/github";
import { scanSourceFiles, verifyFindings } from "../plugins/security";
import { commentMailedWorkItem, publishSecurityFindings } from "./fairlx-side-effects";
import { createAgentJob, findLatestJobForRun, getAgentJob, waitForAgentJob } from "./jobs";
import { scheduleAgentJob } from "./schedule-job";
import {
  findActiveCodingSessionForWorkItem,
  findCodingSessionByRun,
  getCodingSession,
  updateCodingSession,
  appendSessionEvent,
  withSessionMeta,
} from "./coding-sessions";
import { startOrResumeCodingSession, pushCodingSessionBranch } from "./coding-session-start";
import { parseImplementationPlan, persistImplementationPlan } from "./implementation-plan";
import { getSandboxDriver, redactSecrets, sandboxDriverKind, sandboxIsAlive } from "./sandbox";
import { agentDebugLog } from "./sandbox/debug-log";
import {
  azureSandboxFailureCode,
  isAzureSandboxAccessError,
  probeAzureSandboxAccess,
} from "./sandbox/azure";
import { isSandboxGoneError, sandboxSessionFailurePresentation } from "./sandbox/workspace";
import { describeCodingPreview } from "./sandbox-preview";
import { captureSandboxPreview } from "./sandbox-browser";
import { resolveSandboxCodingAgent, sandboxImplementShell } from "./sandbox-coding-agent";

export type ToolExecutionContext = {
  runId: string;
  userId: string;
  context: AgentContext;
  harness: AgentHarness;
  mcp: McpConfig;
  databases?: Databases;
  runs?: AgentRun[];
  workspaceId?: string;
  projectId?: string;
  mcpAuth?: AuthContext;
  allowPersonalSave?: boolean;
  plugins?: AgentPluginConnection[];
  sourcePrompt?: string;
  latestUserText?: string;
  userTexts?: string[];
  userAccepted?: boolean;
  permissionType?: AgentPermissionType;
  turnLimits?: DocTurnLimits;
};

export { MAX_PROJECT_DOCS_PER_TURN } from "./doc-turn-limits";

export type ToolExecutionResult = {
  content: string;
  event: AgentToolEvent;
  harnessPatch?: Partial<Pick<AgentHarness, "gitStaging" | "chatMeta" | "knowledge" | "plugins">>;
  delegate?: { agent: AgentSpecialistId; task: string; subject?: string };
  missingCapability?: AgentCapability;
};

export type { OpenAiTool } from "./tool-schemas";
export { askUserTool, openaiToolsForMode, openaiToolsForTurn, trainingSaveTool } from "./tool-schemas";

function compactEventPayload(type: string, payload: unknown): unknown {
  if (payload == null) return payload;
  if (type === "submit_implementation_plan") {
    const plan = parseImplementationPlan(payload);
    if (plan) return persistImplementationPlan(plan);
    const source = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
    if (source) return { title: source.title, status: source.status, summary: source.summary };
  }
  try {
    if (JSON.stringify(payload).length <= 800) return payload;
  } catch {
    return undefined;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { truncated: true };
  }
  const source = payload as Record<string, unknown>;
  const slim: Record<string, unknown> = {};
  for (const key of [
    "server",
    "tool",
    "error",
    "query",
    "name",
    "kind",
    "command",
    "cwd",
    "status",
    "sessionId",
    "sandboxId",
    "previewUrl",
    "jobId",
    "driver",
    "previewLive",
    "previewStub",
    "workItemId",
    "exitCode",
    "html_url",
    "htmlUrl",
    "githubUrl",
    "url",
    "path",
    "owner",
    "repo",
    "fullName",
    "private",
    "branch",
    "headBranch",
    "number",
    "title",
    "note",
    "codingAgent",
    "artifacts",
    "action",
    "view",
    "zoom",
    "filters",
    "itemId",
  ]) {
    if (source[key] != null) slim[key] = source[key];
  }
  return Object.keys(slim).length ? slim : { truncated: true };
}

function event(
  runId: string,
  type: AgentToolEventType,
  title: string,
  detail?: string,
  payload?: unknown,
): AgentToolEvent {
  return {
    id: crypto.randomUUID(),
    type,
    title,
    detail,
    payload: compactEventPayload(type, payload),
    createdAt: new Date().toISOString(),
    runId,
  };
}

export function failedToolResult(runId: string, name: string, error: unknown): ToolExecutionResult {
  const message = error instanceof Error ? error.message : String(error || "Tool failed");
  return {
    content: JSON.stringify({ error: message }),
    event: event(runId, "error", `${name} failed`, message, { error: message }),
  };
}

function parseArgs(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return { raw: args };
    }
  }
  if (args && typeof args === "object") return args as Record<string, unknown>;
  return {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function isDocCreateTool(name: string, parsed: Record<string, unknown>): boolean {
  if (name === "fairlx_doc_create") return true;
  if (name !== "mcp_call") return false;
  const tool = asString(parsed.tool || parsed.name || parsed.method);
  return tool === "fairlx_doc_create";
}

function researchRequiredResult(runId: string, calls: number): ToolExecutionResult {
  const payload = researchRequiredPayload(calls);
  return {
    content: JSON.stringify(payload),
    event: event(runId, "mcp_call", "Research required before saving", payload.instruction, payload),
  };
}

function ensureTurnLimits(ctx: ToolExecutionContext): DocTurnLimits {
  const limits = ctx.turnLimits ?? emptyDocTurnLimits();
  if (typeof limits.webResearchCalls !== "number") limits.webResearchCalls = 0;
  if (typeof limits.docCreates !== "number") limits.docCreates = 0;
  if (typeof limits.webFetches !== "number") limits.webFetches = 0;
  ctx.turnLimits = limits;
  return limits;
}

function tooManyDocsResult(runId: string, createdThisTurn: number): ToolExecutionResult {
  const payload = docPackCompletePayload(createdThisTurn);
  return {
    content: JSON.stringify(payload),
    event: event(runId, "mcp_call", "Documentation pack complete", payload.instruction, payload),
  };
}

export function applyScopeDefaults(args: Record<string, unknown>, ctx: ToolExecutionContext): Record<string, unknown> {
  const next = { ...args };
  const rawWs = asString(next.workspaceId);
  if (!rawWs) {
    if (ctx.workspaceId) next.workspaceId = ctx.workspaceId;
  } else {
    const matchedWs = ctx.context.workspaces.find(
      (w) => w.id === rawWs || w.name.toLowerCase() === rawWs.toLowerCase()
    );
    if (matchedWs) next.workspaceId = matchedWs.id;
  }
  const rawProj = asString(next.projectId);
  if (!rawProj) {
    if (ctx.projectId) next.projectId = ctx.projectId;
  } else {
    const matchedProj = ctx.context.projects.find(
      (p) =>
        p.id === rawProj ||
        p.name.toLowerCase() === rawProj.toLowerCase() ||
        (p.key && p.key.toLowerCase() === rawProj.toLowerCase())
    );
    if (matchedProj) next.projectId = matchedProj.id;
  }
  if (next.arguments && typeof next.arguments === "object") {
    next.arguments = applyScopeDefaults(next.arguments as Record<string, unknown>, ctx);
  }
  return next;
}

function matchesQuery(haystack: string, query: string): boolean {
  if (!query.trim()) return true;
  return haystack.toLowerCase().includes(query.toLowerCase());
}

export async function executeTool(
  name: string,
  args: unknown,
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const parsed = applyScopeDefaults(parseArgs(args), ctx);
  const targetTool =
    name.startsWith("fairlx_")
      ? name
      : name === "mcp_call"
        ? asString(parsed.tool || parsed.name || parsed.method)
        : name;
  const permissionType = ctx.permissionType ?? ctx.harness?.settings.permissionType;
  const userTexts = ctx.userTexts?.length ? ctx.userTexts : [ctx.latestUserText || ""];
  const destructiveBlock = destructiveToolBlockReason({
    toolName: targetTool,
    userAccepted: ctx.userAccepted,
    permissionType,
    userTexts,
  });
  if (destructiveBlock) {
    const payload = {
      error:
        destructiveBlock === "not_requested"
          ? DESTRUCTIVE_NOT_REQUESTED_MESSAGE
          : DESTRUCTIVE_REQUIRES_ACCEPT_MESSAGE,
      code: destructiveBlock === "not_requested" ? "DESTRUCTIVE_NOT_REQUESTED" : "DESTRUCTIVE_REQUIRES_ACCEPT",
    };
    return {
      content: JSON.stringify(payload),
      event: event(ctx.runId, "error", "Delete blocked", payload.error, payload),
    };
  }
  const limits = ensureTurnLimits(ctx);
  if (isDocCreateTool(name, parsed)) {
    if (!hasRequiredWebResearch(limits)) {
      return researchRequiredResult(ctx.runId, limits.webResearchCalls);
    }
    if (name === "fairlx_doc_create" && limits.docCreates >= MAX_PROJECT_DOCS_PER_TURN) {
      return tooManyDocsResult(ctx.runId, limits.docCreates);
    }
  }
  if (name.startsWith("fairlx_")) {
    const inner = await executeTool(
      "mcp_call",
      { server: "fairlx", tool: name, arguments: parsed },
      ctx,
    );
    return {
      ...inner,
      content: compactJsonString(unwrapMcpToolContent(inner.content), 8000),
    };
  }
  const query = asString(parsed.query || parsed.q || parsed.search);
  const { context, harness, mcp, runId } = ctx;
  const publicMcp = toPublicMcpConfig(ensurePersonalMcp(mcp));
  const mcpCtx = {
    userId: ctx.userId,
    mcp,
    harness,
    runs: ctx.runs,
    databases: ctx.databases,
    auth: ctx.mcpAuth,
  };

  switch (name) {
    case "code_inspect": {
      const kind = asString(parsed.kind) || "all";
      const workItems = context.workItems.filter((item) =>
        matchesQuery(`${item.key ?? ""} ${item.title} ${item.status ?? ""}`, query),
      );
      const listed =
        ctx.databases && (kind === "all" || kind === "repo")
          ? await githubListAccountRepos({
              databases: ctx.databases,
              context,
              userId: ctx.userId,
              projectId: ctx.projectId,
              query: query || undefined,
            })
          : undefined;
      const repos = listed
        ? listed.repositories
        : context.githubRepos.filter((repo) =>
            matchesQuery(`${repo.repositoryName ?? ""} ${repo.owner ?? ""} ${repo.githubUrl ?? ""}`, query),
          );
      const docs = context.docs.filter((doc) =>
        matchesQuery(`${doc.title ?? ""} ${doc.name ?? ""} ${doc.description ?? ""}`, query),
      );
      const payload = {
        kind,
        query,
        accountConnected: listed?.accountConnected ?? Boolean(context.githubAccount?.connected),
        githubLogin: listed?.githubLogin ?? context.githubAccount?.login,
        workItems: kind === "repo" || kind === "doc" ? [] : workItems.slice(0, 12),
        repos: kind === "work_item" || kind === "doc" ? [] : repos.slice(0, 12),
        docs: kind === "work_item" || kind === "repo" ? [] : docs.slice(0, 12),
        hint: listed?.hint,
      };
      return {
        content: JSON.stringify(payload),
        event: event(
          runId,
          "code_inspect",
          "Inspected Fairlx code context",
          query || "Current work items, repos, and docs",
          payload,
        ),
      };
    }
    case "terminal": {
      const command = asString(parsed.command || parsed.cmd || parsed.input);
      const cwd = asString(parsed.cwd) || "/workspace";
      if (ctx.databases && command) {
        const session = await findCodingSessionByRun(ctx.databases, runId);
        if (session?.sandboxId) {
          try {
            const result = await getSandboxDriver().exec(session.sandboxId, command, cwd);
            const payload = {
              command: redactSecrets(command),
              cwd,
              status: result.exitCode === 0 ? "ok" : "failed",
              stdout: result.stdout.slice(0, 8000),
              stderr: result.stderr.slice(0, 2000),
              exitCode: result.exitCode,
              sandboxId: session.sandboxId,
              sessionId: session.id,
            };
            return {
              content: JSON.stringify(payload),
              event: event(runId, "terminal", command, result.stdout.slice(0, 400) || result.stderr.slice(0, 200), payload),
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : "Sandbox exec failed";
            return {
              content: JSON.stringify({ error: message, command: redactSecrets(command) }),
              event: event(runId, "error", "Sandbox exec failed", message),
            };
          }
        }
      }
      const payload = {
        command,
        cwd,
        status: "recorded",
        note: "No coding session sandbox is bound to this run. Call coding_session_start first. Never executed on the Fairlx host.",
      };
      return {
        content: JSON.stringify(payload),
        event: event(
          runId,
          "terminal",
          command || "Recorded terminal command",
          payload.note,
          payload,
        ),
      };
    }
    case "file_search": {
      const attached = attachedSearchPayload(query, extractAttachedFiles(ctx.sourcePrompt || ""));
      const docs = context.docs.filter((doc) =>
        matchesQuery(`${doc.title ?? ""} ${doc.name ?? ""} ${doc.description ?? ""} ${doc.category ?? ""}`, query),
      );
      const workItems = context.workItems.filter((item) =>
        matchesQuery(`${item.key ?? ""} ${item.title}`, query),
      );
      const payload = { query, docs: docs.slice(0, 20), workItems: workItems.slice(0, 20), ...(attached ?? {}) };
      return {
        content: JSON.stringify(payload),
        event: event(
          runId,
          "file_search",
          query ? `Searched files for "${query}"` : "Searched Fairlx files",
          undefined,
          payload,
        ),
      };
    }
    case "web_search": {
      if (!query.trim()) {
        const payload = { error: "query is required" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "web_search", "Web search missing query", payload.error, payload),
        };
      }
      const result = await searchPublicWeb(query);
      const limits = ensureTurnLimits(ctx);
      noteWebResearch(limits);
      const payload = {
        query: result.query,
        hits: result.hits,
        extracts: result.extracts,
        hint:
          result.hits.length === 0
            ? "No hits. Try a more specific query, then web_fetch known public URLs (Wikipedia, vendor docs, regulations)."
            : hasRequiredWebResearch(limits)
              ? "Research bar is met. Fetch at most two more pages if needed, then fairlx_doc_create the PRD. Do not fairlx_work_item_get each epic."
              : "web_fetch the most relevant URLs and cite them in Sources. Do not save a document until you have done this for several queries.",
      };
      return {
        content: JSON.stringify(payload),
        event: event(
          runId,
          "web_search",
          `Web search: ${query}`,
          result.hits[0]?.title || `${result.hits.length} hits`,
          { query, hits: result.hits.length, extracts: result.extracts.length },
        ),
      };
    }
    case "web_fetch": {
      const url = asString(parsed.url || parsed.href || query);
      const fetchLimits = ensureTurnLimits(ctx);
      if (!reserveWebFetchSlot(fetchLimits)) {
        const payload = webFetchCapPayload(fetchLimits.webFetches);
        return {
          content: JSON.stringify(payload),
          event: event(runId, "web_fetch", "Fetch cap reached", payload.instruction, payload),
        };
      }
      const fetched = await fetchPublicPage(url);
      if ("error" in fetched) {
        if (fetchLimits.webFetches > 0) fetchLimits.webFetches -= 1;
        return {
          content: JSON.stringify(fetched),
          event: event(runId, "web_fetch", "Web fetch failed", fetched.error, fetched),
        };
      }
      noteWebResearch(ensureTurnLimits(ctx));
      return {
        content: JSON.stringify(fetched),
        event: event(runId, "web_fetch", `Fetched ${fetched.title || url}`, url, { url: fetched.url }),
      };
    }
    case "database_query": {
      const collection = asString(parsed.collection || parsed.table || parsed.target) || "all";
      const payload = {
        collection,
        query,
        workspaces: collection === "all" || collection === "workspaces" ? context.workspaces : [],
        projects: collection === "all" || collection === "projects" ? context.projects : [],
        workItems: collection === "all" || collection === "work_items" ? context.workItems : [],
        docs: collection === "all" || collection === "docs" ? context.docs : [],
      };
      return {
        content: JSON.stringify(payload),
        event: event(runId, "database_query", `Queried ${collection}`, query || undefined, payload),
      };
    }
    case "use_skill": {
      const skillId = asString(parsed.skillId || parsed.id);
      const skillName = asString(parsed.name);
      const skill =
        harness.skills.find((item) => item.id === skillId || item.name.toLowerCase() === skillName.toLowerCase()) ??
        harness.skills.find((item) => item.enabled);
      const payload = skill
        ? {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            instructions: skill.instructions,
            enabled: skill.enabled,
          }
        : { error: "Skill not found", skillId, skillName };
      return {
        content: JSON.stringify(payload),
        event: event(
          runId,
          "use_skill",
          skill ? `Used skill: ${skill.name}` : "Skill not found",
          skill?.description,
          payload,
        ),
      };
    }
    case "list_workspaces": {
      const orgs = new Map((context.organizations ?? []).map((item) => [item.id, item.name]));
      const payload = {
        workspaces: context.workspaces.map(({ inviteCode: _inviteCode, ...rest }) => ({
          ...rest,
          organizationName: rest.organizationId ? orgs.get(rest.organizationId) : undefined,
        })),
        organizations: (context.organizations ?? []).map(({ id: _id, ...rest }) => rest),
      };
      return {
        content: JSON.stringify(payload),
        event: event(runId, "list_workspaces", `${context.workspaces.length} workspaces`, undefined, payload),
      };
    }
    case "list_projects": {
      const workspaceId = asString(parsed.workspaceId);
      const projects = workspaceId
        ? context.projects.filter((project) => project.workspaceId === workspaceId)
        : context.projects;
      const payload = { workspaceId: workspaceId || undefined, projects };
      return {
        content: JSON.stringify(payload),
        event: event(runId, "list_projects", `${projects.length} projects`, undefined, payload),
      };
    }
    case "list_work_items": {
      const workspaceId = asString(parsed.workspaceId);
      const projectId = asString(parsed.projectId);
      const items = context.workItems.filter((item) => {
        if (workspaceId && item.workspaceId !== workspaceId) return false;
        if (projectId && item.projectId !== projectId) return false;
        return matchesQuery(`${item.key ?? ""} ${item.title} ${item.status ?? ""}`, query);
      });
      const payload = { workspaceId: workspaceId || undefined, projectId: projectId || undefined, workItems: items };
      return {
        content: JSON.stringify(payload),
        event: event(runId, "list_work_items", `${items.length} work items`, undefined, payload),
      };
    }
    case "mcp_list": {
      const entries = Object.entries(publicMcp.mcpServers ?? {});
      const servers = await Promise.all(
        entries.map(async ([serverName, server]) => {
          const base = {
            name: serverName,
            transport: server.transport,
            url: server.url,
            command: server.command,
            disabled: Boolean(server.disabled),
            personal: serverName === "fairlx-personal",
            fairlxNative: serverName === "fairlx" || server.url === "/api/mcp",
          };
          if (server.disabled) return { ...base, tools: [] as Array<{ name: string; description?: string }> };
          try {
            const listed = await listMcpToolsForServer(serverName, mcpCtx);
            const record = listed && typeof listed === "object" ? (listed as Record<string, unknown>) : {};
            const toolsRaw = Array.isArray(record.tools)
              ? record.tools
              : Array.isArray((record.result as { tools?: unknown[] } | undefined)?.tools)
                ? ((record.result as { tools?: unknown[] }).tools ?? [])
                : [];
            const tools = toolsRaw.flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              const tool = item as { name?: string; description?: string };
              return tool.name ? [{ name: tool.name, description: tool.description }] : [];
            });
            return { ...base, tools };
          } catch (error) {
            return {
              ...base,
              tools: [] as Array<{ name: string; description?: string }>,
              error: error instanceof Error ? error.message : "Failed to list tools",
            };
          }
        }),
      );
      const payload = {
        servers,
        note: "Fairlx native tools stay fairlx_*. mcp_call is for external HTTP MCP servers (Sentry, Datadog, etc.). Add a server in Agent → Manage MCP.",
      };
      return {
        content: JSON.stringify(payload),
        event: event(runId, "mcp_list", `${servers.length} MCP servers`, undefined, payload),
      };
    }
    case "mcp_call": {
      const tool = asString(parsed.tool || parsed.name || parsed.method);
      const server = asString(parsed.server) || "fairlx";
      const callArgs =
        parsed.arguments && typeof parsed.arguments === "object"
          ? (parsed.arguments as Record<string, unknown>)
          : parsed.args && typeof parsed.args === "object"
            ? (parsed.args as Record<string, unknown>)
            : {};
      if (!tool) {
        const payload = { error: "tool is required" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "mcp_call", "MCP call missing tool", undefined, payload),
        };
      }
      const effectiveArgs = applyScopeDefaults(callArgs, ctx);
      console.log(`[Fairlx Agent] 🛠️ Calling MCP Tool -> Server: "${server}", Tool: "${tool}", Args:`, JSON.stringify(effectiveArgs));
      const limits = ensureTurnLimits(ctx);
      if (tool === "fairlx_doc_create" && !hasRequiredWebResearch(limits)) {
        return researchRequiredResult(runId, limits.webResearchCalls);
      }
      if (tool === "fairlx_doc_create" && !reserveDocCreateSlot(limits)) {
        return tooManyDocsResult(runId, limits.docCreates);
      }
      try {
        const result = await callMcpServerTool({
          server,
          tool,
          args: effectiveArgs,
          ctx: mcpCtx,
          userAccepted: destructiveUserAccepted({
            userAccepted: ctx.userAccepted,
            permissionType: ctx.permissionType ?? ctx.harness?.settings.permissionType,
            userTexts: ctx.userTexts?.length ? ctx.userTexts : [ctx.latestUserText || ""],
          }),
        });
        console.log(`[Fairlx Agent] ✅ MCP Tool "${tool}" succeeded:`, JSON.stringify(result));
        return {
          content: compactJsonString(JSON.stringify(result), 8000),
          event: event(runId, "mcp_call", tool.replace(/^fairlx_/, "").replaceAll("_", " "), undefined, { server, tool }),
        };
      } catch (error) {
        if (tool === "fairlx_doc_create") releaseDocCreateSlot(limits);
        const errorMessage = error instanceof Error ? error.message : "MCP call failed";
        console.error(`[Fairlx Agent] ❌ MCP Tool "${tool}" failed:`, errorMessage, { server, args: effectiveArgs });
        const payload = { server, tool, error: errorMessage };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", `${tool.replace(/^fairlx_/, "").replaceAll("_", " ")} failed`, payload.error, payload),
        };
      }
    }
    case "mcp_resources": {
      const server = asString(parsed.server) || "fairlx-personal";
      try {
        const result = await listMcpResourcesForServer(server, mcpCtx);
        return {
          content: JSON.stringify(result),
          event: event(runId, "mcp_resources", `Resources: ${server}`, undefined, result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Failed to list MCP resources" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "MCP resources failed", payload.error, payload),
        };
      }
    }
    case "delegate_agent": {
      const agent = specialistById(asString(parsed.agent) || "planner");
      const task = asString(parsed.task || parsed.prompt || query);
      const subject = asString(parsed.subject) || undefined;
      const payload = { agent, task, subject };
      return {
        content: JSON.stringify(payload),
        event: event(runId, "delegate_agent", `Delegated to ${agent}${subject ? ` · ${subject}` : ""}`, task || undefined, payload),
        delegate: {
          agent: agent === "orchestrator" ? "planner" : agent,
          task: task || "Continue the current request.",
          subject,
        },
      };
    }
    case "submit_implementation_plan": {
      const plan = parseImplementationPlan(parsed);
      if (!plan) {
        const payload = { error: "title and at least one phase with tasks are required" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Implementation plan incomplete", payload.error, payload),
        };
      }
      const accepted = { ...plan, status: "accepted" as const };
      return {
        content: JSON.stringify(accepted),
        event: event(runId, "submit_implementation_plan", accepted.title, accepted.summary, accepted),
      };
    }
    case "search_harness": {
      const files = extractAttachedFiles(ctx.sourcePrompt || "");
      if (files.length) {
        const attached = attachedSearchPayload(query || files[0]!.name, files) ?? {
          source: "attached_files",
          files: files.map((file) => ({ name: file.name, content: file.body })),
        };
        return {
          content: JSON.stringify(attached),
          event: event(
            runId,
            "search_harness",
            query ? `Attached spec: ${query}` : "Attached spec",
            `${files.length} attached files`,
            attached as Record<string, unknown>,
          ),
        };
      }
      const hits = searchAgentIndex({
        query,
        runs: ctx.runs,
        context,
        harness,
        mcp: publicMcp,
        limit: 24,
      });
      const payload = { query, hits };
      return {
        content: JSON.stringify(payload),
        event: event(runId, "search_harness", query ? `Search: ${query}` : "Harness search", `${hits.length} hits`, payload),
      };
    }
    case "create_project": {
      const workspaceId =
        asString(parsed.workspaceId) || harness.settings.defaultWorkspaceId || context.workspaces[0]?.id || "";
      const name = asString(parsed.name || parsed.title);
      if (!ctx.databases) {
        const payload = { error: "Project creation is unavailable in this turn." };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Create project unavailable", undefined, payload),
        };
      }
      try {
        const created = await createFairlxProject({
          databases: ctx.databases,
          userId: ctx.userId,
          workspaceId,
          name,
          description: asString(parsed.description) || undefined,
        });
        return {
          content: JSON.stringify(created),
          event: event(runId, "create_project", `Created project ${created.name}`, created.workspaceId, created),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Failed to create project." };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Create project failed", payload.error, payload),
        };
      }
    }
    case "git_status": {
      let listed: Awaited<ReturnType<typeof githubListAccountRepos>> | undefined;
      if (ctx.databases) {
        listed = await githubListAccountRepos({
          databases: ctx.databases,
          context,
          userId: ctx.userId,
          projectId: ctx.projectId,
        });
      }
      const payload = {
        accountConnected: listed?.accountConnected ?? Boolean(context.githubAccount?.connected),
        githubLogin: listed?.githubLogin ?? context.githubAccount?.login,
        projectRepositories: listed?.projectRepositories ?? context.githubRepos,
        githubRepositories: listed?.githubRepositories ?? [],
        repos: listed?.repositories ?? context.githubRepos,
        staging: harness.gitStaging,
        hint: listed?.hint,
        note: listed?.accountConnected
          ? "Use github_list_repos to search this user's GitHub account. Use github_write_file and github_open_pr for real GitHub commits and PRs. Fairlx never runs git on the host."
          : "Use github_write_file and github_open_pr for real GitHub commits and PRs. Fairlx never runs git on the host.",
      };
      return {
        content: JSON.stringify(payload),
        event: event(
          runId,
          "git_status",
          `${payload.repos.length} repos · ${harness.gitStaging.items.filter((item) => item.status === "staged").length} staged`,
          undefined,
          payload,
        ),
      };
    }
    case "git_stage": {
      const next = stageItem(harness.gitStaging, {
        path: asString(parsed.path || parsed.file),
        summary: asString(parsed.summary || parsed.message),
        repoId: asString(parsed.repoId) || undefined,
        branch: asString(parsed.branch) || undefined,
        content: asString(parsed.content) || undefined,
      });
      const payload = { staging: next };
      return {
        content: JSON.stringify(payload),
        event: event(runId, "git_stage", `Staged ${asString(parsed.path)}`, undefined, payload),
        harnessPatch: { gitStaging: next },
      };
    }
    case "git_unstage": {
      const next = unstageItem(harness.gitStaging, asString(parsed.id || parsed.path));
      const payload = { staging: next };
      return {
        content: JSON.stringify(payload),
        event: event(runId, "git_unstage", "Unstaged change", undefined, payload),
        harnessPatch: { gitStaging: next },
      };
    }
    case "git_commit_plan": {
      const planned = commitStaged(harness.gitStaging, asString(parsed.message || parsed.commit));
      const payload = {
        message: planned.message,
        committed: planned.committed,
        staging: planned.staging,
        note: "Commit recorded in the harness buffer. Not executed on the host.",
      };
      return {
        content: JSON.stringify(payload),
        event: event(runId, "git_commit_plan", planned.message, `${planned.committed.length} files`, payload),
        harnessPatch: { gitStaging: planned.staging },
      };
    }
    case "run_automation": {
      const id = asString(parsed.automationId || parsed.id);
      const nameArg = asString(parsed.name);
      const automation =
        harness.automations.find((item) => item.id === id || item.name.toLowerCase() === nameArg.toLowerCase()) ??
        matchingAutomations(harness, query || nameArg)[0];
      const payload = automation
        ? {
            id: automation.id,
            name: automation.name,
            trigger: automation.trigger,
            action: automation.action,
            enabled: automation.enabled,
          }
        : { error: "Automation not found", id, name: nameArg };
      return {
        content: JSON.stringify(payload),
        event: event(
          runId,
          "run_automation",
          automation ? `Automation: ${automation.name}` : "Automation not found",
          automation?.action,
          payload,
        ),
      };
    }
    case "personal_read": {
      const kind = asString(parsed.kind) || "harness";
      const payload = readPersonalContent({ kind, harness, runs: ctx.runs, query });
      return {
        content: JSON.stringify(payload),
        event: event(runId, "personal_read", `Personal ${kind}`, undefined, payload),
      };
    }
    case "save_personal_agent": {
      if (!ctx.allowPersonalSave) {
        const payload = { error: "save_personal_agent is only available during Personal Agent training." };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Save personal agent unavailable", undefined, payload),
        };
      }
      if (!ctx.databases) {
        const payload = { error: "Saving the Personal Agent is unavailable in this turn." };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Save personal agent unavailable", undefined, payload),
        };
      }
      const personaRole = isPersonalPersonaRole(parsed.personaRole) ? parsed.personaRole : "frontend";
      const rawAnswers = Array.isArray(parsed.answers) ? parsed.answers : [];
      const answers = rawAnswers
        .map((item, index) => {
          const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          const question = asString(row.question);
          const answer = asString(row.answer);
          return {
            questionId: asString(row.questionId) || `q${index + 1}`,
            question,
            answer,
          };
        })
        .filter((item) => item.question && item.answer);
      if (answers.length < 4) {
        const payload = { error: "Need at least four detailed question/answer pairs before saving." };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Interview incomplete", undefined, payload),
        };
      }
      const workspace =
        context.workspaces.find((item) => item.id === ctx.workspaceId) ?? context.workspaces[0];
      const project =
        context.projects.find((item) => item.id === ctx.projectId) ??
        context.projects.find((item) => item.workspaceId === workspace?.id);
      const compiled =
        asString(parsed.compiledPrompt).trim().length >= 400
          ? asString(parsed.compiledPrompt).trim()
          : compilePersonalPrompt({
              userName: context.user.name || context.user.email || "this user",
              personaRole,
              jobTitle: asString(parsed.jobTitle) || undefined,
              workspaceRole: workspace?.role,
              workspaceName: workspace?.name,
              projectName: project?.name,
              answers,
            });
      try {
        const profile = await upsertPersonalAgent(ctx.databases, ctx.userId, {
          personaRole,
          jobTitle: asString(parsed.jobTitle) || undefined,
          workspaceRole: workspace?.role,
          status: "trained",
          answers,
          compiledPrompt: compiled,
        });
        const payload = {
          saved: true,
          version: profile.promptVersion,
          personaRole: profile.personaRole,
        };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "save_personal_agent", "Personal Agent trained", `v${profile.promptVersion}`, payload),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Failed to save personal agent." };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Save personal agent failed", payload.error, payload),
        };
      }
    }
    case "request_capability": {
      const capability = (asString(parsed.capability) || "email.send") as AgentCapability;
      const plugins = ctx.plugins ?? harness.plugins;
      const githubConnected = isGithubCapability(capability) && hasGithubAccount(context);
      const granted = githubConnected || hasCapability(plugins, context, capability);
      const catalog = granted ? [] : catalogForCapability(capability);
      const githubInstruction = githubConnected
        ? hasProjectGithubRepo(context, ctx.projectId)
          ? "GitHub is already connected. Do not ask the user to reconnect. Call github_list_files, github_read_file, github_write_file, github_open_pr, or security_review as needed."
          : `GitHub is already connected${context.githubAccount?.login ? ` as @${context.githubAccount.login}` : ""}. Attaching a repository to this Fairlx project is not a new GitHub sign-in. Call github_link_repo with owner and repo (for example owner ANCIENTINSANE and repo Fairlx-Dev, or repoId ANCIENTINSANE/Fairlx-Dev). Do not call request_capability again. Do not github_create_repo unless they asked to create a new repository.`
        : undefined;
      const payload: Record<string, unknown> = {
        capability,
        granted,
        alreadyConnected: granted,
        reason: asString(parsed.reason),
        catalogIds: catalog.map((item) => item.id),
        missing: granted
          ? []
          : missingCapabilities(`${capability} ${asString(parsed.reason)}`, plugins, context),
        instruction: githubInstruction
          || (granted
            ? `Capability ${capability} is already available. Do not ask the user to reconnect. Call github_list_files, github_read_file, github_write_file, github_open_pr, or security_review as needed.`
            : undefined),
      };
      if (
        githubConnected &&
        ctx.databases &&
        ctx.projectId &&
        !hasProjectGithubRepo(context, ctx.projectId)
      ) {
        const haystack = [ctx.latestUserText, ...(ctx.userTexts ?? []), asString(parsed.reason), ctx.sourcePrompt]
          .filter(Boolean)
          .join("\n");
        const attach = parseGithubAttachRequest(haystack);
        if (attach) {
          const linked = await githubLinkRepo({
            databases: ctx.databases,
            userId: ctx.userId,
            projectId: ctx.projectId,
            owner: attach.owner,
            repo: attach.repo,
          });
          const ok = "linked" in linked && Boolean(linked.linked);
          return {
            content: JSON.stringify({ ...payload, ...linked }),
            event: event(
              runId,
              ok ? "github_link_repo" : "request_capability",
              ok && "fullName" in linked ? `Attached ${linked.fullName}` : "Already have code.write",
              "instruction" in linked ? linked.instruction : githubInstruction,
              { ...payload, ...linked },
            ),
          };
        }
      }
      return {
        content: JSON.stringify(payload),
        event: event(
          runId,
          "request_capability",
          granted ? `Already have ${capability}` : `Need ${capability}`,
          asString(parsed.reason),
          payload,
        ),
        missingCapability: granted ? undefined : capability,
      };
    }
    case "persist_memory": {
      const fact = asString(parsed.fact);
      if (!fact) {
        return {
          content: JSON.stringify({ error: "fact is required" }),
          event: event(runId, "error", "Memory missing fact"),
        };
      }
      const existing = harness.knowledge.find((item) => item.title === "Agent STATE");
      const nextItem = existing
        ? { ...existing, content: `${existing.content}\n- ${fact}`.slice(-4000), createdAt: new Date().toISOString() }
        : {
            id: crypto.randomUUID(),
            title: "Agent STATE",
            content: `- ${fact}`,
            source: "brain",
            createdAt: new Date().toISOString(),
          };
      const knowledge = existing
        ? harness.knowledge.map((item) => (item.id === existing.id ? nextItem : item))
        : [...harness.knowledge, nextItem];
      return {
        content: JSON.stringify({ stored: true, fact }),
        event: event(runId, "persist_memory", "Stored a fact", fact.slice(0, 120)),
        harnessPatch: { knowledge },
      };
    }
    case "mail_send": {
      const workItemKey = asString(parsed.workItemKey) || undefined;
      const result = await sendMailViaPlugin({
        plugins: ctx.plugins ?? harness.plugins,
        mcp,
        input: {
          to: asString(parsed.to),
          subject: asString(parsed.subject),
          body: asString(parsed.body),
          cc: asString(parsed.cc) || undefined,
          workItemKey,
        },
      });
      const failed = typeof result.error === "string";
      let comment: { commented: boolean; workItemId?: string } | undefined;
      if (!failed && workItemKey) {
        comment = await commentMailedWorkItem({
          databases: ctx.databases,
          context,
          mcp,
          harness,
          userId: ctx.userId,
          mcpAuth: ctx.mcpAuth,
          runs: ctx.runs,
          workItemKey,
          to: asString(parsed.to),
          subject: asString(parsed.subject),
        });
      }
      const updatedPlugin = result.updatedPlugin as AgentPluginConnection | undefined;
      const payload = comment ? { ...result, comment } : result;
      const publicPayload = { ...payload };
      delete publicPayload.updatedPlugin;
      return {
        content: JSON.stringify(publicPayload),
        event: event(
          runId,
          failed ? "error" : "mail_send",
          failed ? "Mail failed" : `Mailed ${asString(parsed.to)}`,
          asString(parsed.subject),
          publicPayload,
        ),
        missingCapability: failed && result.capability === "email.send" ? "email.send" : undefined,
        harnessPatch: updatedPlugin
          ? { plugins: harness.plugins.map((item) => (item.id === updatedPlugin.id ? updatedPlugin : item)) }
          : undefined,
      };
    }
    case "github_account_status": {
      try {
        const result = await githubAccountStatus({
          databases: ctx.databases,
          context,
          userId: ctx.userId,
          projectId: ctx.projectId,
        });
        return {
          content: JSON.stringify(result),
          event: event(runId, "github_account_status", result.connected ? "GitHub account connected" : "GitHub account missing", undefined, result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "GitHub account status failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "GitHub account status failed", payload.error, payload),
          missingCapability: githubPauseCapability(hasGithubAccount(context), payload),
        };
      }
    }
    case "github_list_repos": {
      try {
        const result = await githubListAccountRepos({
          databases: ctx.databases,
          context,
          userId: ctx.userId,
          projectId: ctx.projectId,
          query: asString(parsed.query || parsed.q || parsed.search) || undefined,
        });
        return {
          content: JSON.stringify(result),
          event: event(
            runId,
            "error" in result && !result.accountConnected ? "error" : "github_list_repos",
            result.accountConnected ? `Listed ${result.total} GitHub repositories` : "GitHub account missing",
            "error" in result ? result.error : undefined,
            result,
          ),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Failed to list GitHub repositories" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "GitHub repositories failed", payload.error, payload),
          missingCapability: githubPauseCapability(hasGithubAccount(context), payload),
        };
      }
    }
    case "github_list_owners": {
      try {
        const result = await githubListAccountOwners({
          databases: ctx.databases,
          userId: ctx.userId,
          projectId: ctx.projectId,
        });
        return {
          content: JSON.stringify(result),
          event: event(
            runId,
            "error" in result ? "error" : "github_list_owners",
            "error" in result ? "GitHub owners failed" : "Listed GitHub owners",
            "error" in result ? result.error : undefined,
            result,
          ),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Failed to list GitHub owners" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "GitHub owners failed", payload.error, payload),
          missingCapability: githubPauseCapability(hasGithubAccount(context), payload),
        };
      }
    }
    case "github_create_repo": {
      try {
        const result = await githubCreateRepo({
          databases: ctx.databases,
          userId: ctx.userId,
          projectId: ctx.projectId,
          name: asString(parsed.name),
          owner: asString(parsed.owner) || undefined,
          description: asString(parsed.description) || undefined,
          private: parsed.private !== false,
          autoInit: parsed.autoInit !== false,
          linkToProject: parsed.linkToProject !== false,
        });
        const failed = "error" in result && !("fullName" in result);
        return {
          content: JSON.stringify(result),
          event: event(
            runId,
            failed ? "error" : "github_create_repo",
            failed ? "Create GitHub repository failed" : `Created ${"fullName" in result ? result.fullName : asString(parsed.name)}`,
            failed && "error" in result ? result.error : undefined,
            result,
          ),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Create GitHub repository failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Create GitHub repository failed", payload.error, payload),
          missingCapability: githubPauseCapability(hasGithubAccount(context), payload),
        };
      }
    }
    case "github_link_repo": {
      try {
        const result = await githubLinkRepo({
          databases: ctx.databases,
          userId: ctx.userId,
          projectId: ctx.projectId,
          owner: asString(parsed.owner) || undefined,
          repo: asString(parsed.repo || parsed.name) || undefined,
          repoId: asString(parsed.repoId) || undefined,
          branch: asString(parsed.branch) || undefined,
        });
        const failed = "error" in result;
        return {
          content: JSON.stringify(result),
          event: event(
            runId,
            failed ? "error" : "github_link_repo",
            failed ? "Attach GitHub repository failed" : `Attached ${"fullName" in result ? result.fullName : "repository"}`,
            failed && "error" in result ? result.error : undefined,
            result,
          ),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Attach GitHub repository failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Attach GitHub repository failed", payload.error, payload),
        };
      }
    }
    case "github_list_files": {
      try {
        const session = ctx.databases ? await findCodingSessionByRun(ctx.databases, runId) : null;
        const sessionBranch = githubSessionInspectBranch(session);
        const branch = asString(parsed.branch) || sessionBranch || undefined;
        const sandboxBound = Boolean(session?.sandboxId) && session?.status !== "merged" && session?.status !== "failed";
        const result = await githubListFiles({
          databases: ctx.databases,
          context,
          plugins: ctx.plugins ?? harness.plugins,
          path: asString(parsed.path) || undefined,
          repoId: asString(parsed.repoId) || undefined,
          projectId: ctx.projectId,
          branch,
        });
        if ("missing" in result && result.missing && sandboxBound) {
          const hint = githubSandboxInspectHint({
            sandboxBound: true,
            branch: "branch" in result && typeof result.branch === "string" ? result.branch : branch || "main",
            path: asString(parsed.path) || "/",
          });
          if (hint) Object.assign(result, { hint });
        }
        const failed = "error" in result && !("missing" in result && result.missing);
        return {
          content: JSON.stringify(result),
          event: event(
            runId,
            failed ? "error" : "github_list_files",
            failed
              ? "List repo files failed"
              : "missing" in result && result.missing
                ? `No files at ${asString(parsed.path) || "/"} on ${branch || "default"}`
                : "Listed repo files",
            failed ? result.error : undefined,
            result,
          ),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = {
          error: error instanceof Error ? error.message : "Failed to list files",
          path: asString(parsed.path) || "/",
          missing: true,
        };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "List repo files failed", payload.error, payload),
        };
      }
    }
    case "github_read_file": {
      const path = asString(parsed.path);
      try {
        const session = ctx.databases ? await findCodingSessionByRun(ctx.databases, runId) : null;
        const sessionBranch = githubSessionInspectBranch(session);
        const branch = asString(parsed.branch) || sessionBranch || undefined;
        const sandboxBound = Boolean(session?.sandboxId) && session?.status !== "merged" && session?.status !== "failed";
        const result = await githubReadFile({
          databases: ctx.databases,
          context,
          plugins: ctx.plugins ?? harness.plugins,
          path,
          repoId: asString(parsed.repoId) || undefined,
          projectId: ctx.projectId,
          branch,
        });
        if ("missing" in result && result.missing && sandboxBound) {
          const hint = githubSandboxInspectHint({
            sandboxBound: true,
            branch: "branch" in result && typeof result.branch === "string" ? result.branch : branch || "main",
            path: path || "/",
          });
          if (hint) Object.assign(result, { hint });
        }
        const failed = "error" in result && !("missing" in result && result.missing);
        return {
          content: JSON.stringify(result),
          event: event(
            runId,
            failed ? "error" : "github_read_file",
            failed ? path || "Read file failed" : path || "Read file",
            failed ? result.error : undefined,
            { path, ...result },
          ),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = {
          error: error instanceof Error ? error.message : "Failed to read file",
          path,
          missing: true,
          hint: "List the parent folder with github_list_files and only read paths from that listing.",
        };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", path || "Read file failed", payload.error, payload),
        };
      }
    }
    case "github_write_file": {
      try {
        if (ctx.databases) {
          const session = await findCodingSessionByRun(ctx.databases, runId);
          if (session && session.status !== "merged") {
            const alive = await sandboxIsAlive(getSandboxDriver(), session.sandboxId);
            if (!alive) {
              const restarted = await startOrResumeCodingSession({
                databases: ctx.databases,
                userId: ctx.userId,
                runId,
                context,
                harness,
                plugins: ctx.plugins ?? harness.plugins,
                workItemId: session.workItemId,
                projectId: ctx.projectId || session.projectId,
                repoId: session.repoId,
                baseBranch: session.baseBranch,
                autoMode: ctx.harness?.settings.autonomousCoding === true || ctx.permissionType === "all_access",
              });
              if ("error" in restarted) {
                const present = sandboxSessionFailurePresentation(restarted.error);
                const payload = {
                  error: String(restarted.error),
                  hint: present.hint,
                  retryable: true,
                  code: present.code,
                };
                return {
                  content: JSON.stringify(payload),
                  event: event(runId, "error", present.title, payload.error, payload),
                };
              }
              const payload = {
                error:
                  "A new Azure sandbox is running. Write files with coding_session_exec or coding_session_implement in /workspace. Do not github_write_file.",
                sessionId: restarted.sessionId,
                sandboxId: restarted.sandboxId,
                recreated: true,
              };
              return {
                content: JSON.stringify(payload),
                event: event(runId, "coding_session_start", "Sandbox recreated", undefined, payload),
              };
            }
            const payload = {
              error:
                "A coding session sandbox is running. Write files with coding_session_exec in /workspace, then open a PR from that branch. Do not use github_write_file while the sandbox is bound.",
              sessionId: session.id,
              headBranch: session.headBranch,
              previewUrl: session.previewUrl,
            };
            return {
              content: JSON.stringify(payload),
              event: event(runId, "error", "Use the coding session sandbox", payload.error, payload),
            };
          }
        }
        const result = await githubWriteFile({
          databases: ctx.databases,
          context,
          plugins: ctx.plugins ?? harness.plugins,
          path: asString(parsed.path),
          content: asString(parsed.content),
          message: asString(parsed.message) || `Update ${asString(parsed.path)}`,
          branch: asString(parsed.branch) || undefined,
          repoId: asString(parsed.repoId) || undefined,
          owner: asString(parsed.owner) || undefined,
          repo: asString(parsed.repo) || undefined,
          projectId: ctx.projectId,
        });
        const failed = "error" in result;
        return {
          content: JSON.stringify(result),
          event: event(
            runId,
            failed ? "error" : "github_write_file",
            failed ? "GitHub write failed" : `Wrote ${asString(parsed.path)}`,
            asString(parsed.path) || undefined,
            { ...result, path: asString(parsed.path) },
          ),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "GitHub write failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "GitHub write failed", payload.error, payload),
          missingCapability: githubPauseCapability(hasGithubAccount(context), payload),
        };
      }
    }
    case "github_open_pr": {
      try {
        const plugins = ctx.plugins ?? harness.plugins;
        const files = parsePrFiles(parsed.files);
        const title = asString(parsed.title);
        const body = asString(parsed.body) || undefined;
        const repoId = asString(parsed.repoId) || undefined;
        if (files.length && ctx.databases) {
          const session = await findCodingSessionByRun(ctx.databases, runId);
          if (session?.sandboxId) {
            const payload = {
              error:
                "A coding session sandbox is running. Write files in the sandbox and open a PR from that branch instead of passing files[] to github_open_pr.",
              sessionId: session.id,
              headBranch: session.headBranch,
              previewUrl: session.previewUrl,
            };
            return {
              content: JSON.stringify(payload),
              event: event(runId, "error", "Use the coding session for file writes", payload.error, payload),
            };
          }
        }
        if (!files.length && ctx.databases) {
          const session = await findCodingSessionByRun(ctx.databases, runId);
          if (session?.sandboxId) {
            await pushCodingSessionBranch({ databases: ctx.databases, sessionId: session.id, message: title || "fairlx coding session" });
            parsed.head = session.headBranch || parsed.head;
          }
        }
        if (files.length >= 3 && ctx.databases) {
          const job = await createAgentJob(ctx.databases, {
            userId: ctx.userId,
            runId,
            kind: "github_pr",
            payload: {
              repoId,
              projectId: ctx.projectId,
              title,
              body,
              branch: asString(parsed.head || parsed.branch) || undefined,
              base: asString(parsed.base) || undefined,
              files,
            },
          });
          if (job) {
            scheduleAgentJob({
              databases: ctx.databases,
              userId: ctx.userId,
              jobId: job.id,
              context,
              plugins,
              mcp,
              mcpAuth: ctx.mcpAuth,
              harness,
              projectId: ctx.projectId,
              workspaceId: ctx.workspaceId,
            });
            return {
              content: JSON.stringify({ jobId: job.id, status: job.status, files: files.length }),
              event: event(runId, "github_open_pr", "Queued pull request job", job.id, { jobId: job.id }),
            };
          }
        }
        const result = files.length
          ? await githubCommitFilesAndOpenPr({
              databases: ctx.databases,
              context,
              plugins,
              title,
              body,
              files,
              branch: asString(parsed.head || parsed.branch) || undefined,
              base: asString(parsed.base) || undefined,
              repoId,
              projectId: ctx.projectId,
            })
          : await githubOpenPullRequest({
              databases: ctx.databases,
              context,
              plugins,
              title,
              body,
              head: asString(parsed.head || parsed.branch),
              base: asString(parsed.base) || undefined,
              repoId,
              projectId: ctx.projectId,
            });
        if (ctx.databases && !("error" in result) && "html_url" in result) {
          const session = await findCodingSessionByRun(ctx.databases, runId);
          if (session) {
            await updateCodingSession(ctx.databases, session.id, {
              status: "awaiting_review",
              prNumber: typeof result.number === "number" ? result.number : session.prNumber,
              prUrl: typeof result.html_url === "string" ? result.html_url : session.prUrl,
              events: appendSessionEvent(session.events, "pr", title, result),
            });
          }
        }
        return {
          content: JSON.stringify(result),
          event: event(runId, "github_open_pr", title || "Opened pull request", undefined, result),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Failed to open pull request" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Open PR failed", payload.error, payload),
          missingCapability: githubPauseCapability(hasGithubAccount(context), payload),
        };
      }
    }
    case "security_review": {
      const plugins = ctx.plugins ?? harness.plugins;
      if (parsed.deep === true && ctx.databases) {
        const job = await createAgentJob(ctx.databases, {
          userId: ctx.userId,
          runId,
          kind: "security_review",
          payload: { repoId: asString(parsed.repoId), projectId: ctx.projectId },
        });
        if (job) {
          scheduleAgentJob({
            databases: ctx.databases,
            userId: ctx.userId,
            jobId: job.id,
            context,
            plugins,
            mcp,
            mcpAuth: ctx.mcpAuth,
            harness,
            projectId: ctx.projectId,
            workspaceId: ctx.workspaceId,
          });
          return {
            content: JSON.stringify({ jobId: job.id, status: job.status, deep: true }),
            event: event(runId, "security_review", "Queued security review", job.id, { jobId: job.id }),
          };
        }
      }
      const resolved = await resolveGithubRepo({
        databases: ctx.databases,
        context,
        plugins,
        repoId: asString(parsed.repoId) || undefined,
        projectId: ctx.projectId,
      });
      if ("error" in resolved) {
        return {
          content: JSON.stringify(resolved),
          event: event(runId, "error", "Security review blocked", resolved.error, resolved),
          missingCapability: hasGithubAccount(context)
            ? undefined
            : githubPauseCapability(false, resolved) ?? "security.review",
        };
      }
      try {
        const files = await resolved.api.getAllFiles(resolved.owner, resolved.repo, resolved.branch, "", 20);
        const findings = verifyFindings(scanSourceFiles(files));
        const published = await publishSecurityFindings({
          databases: ctx.databases,
          mcp,
          harness,
          userId: ctx.userId,
          mcpAuth: ctx.mcpAuth,
          runs: ctx.runs,
          projectId: ctx.projectId,
          workspaceId: ctx.workspaceId,
          repoLabel: `${resolved.owner}/${resolved.repo}`,
          findings,
        });
        const payload = {
          owner: resolved.owner,
          repo: resolved.repo,
          filesScanned: files.length,
          findings,
          bugs: published.bugs,
          notified: published.notified,
        };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "security_review", `${findings.length} verified findings`, undefined, payload),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Security review failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Security review failed", payload.error, payload),
        };
      }
    }
    case "agent_job_status": {
      if (!ctx.databases) {
        return {
          content: JSON.stringify({ error: "Jobs are unavailable in this turn." }),
          event: event(runId, "error", "Job status unavailable"),
        };
      }
      const job = await getAgentJob(ctx.databases, ctx.userId, asString(parsed.jobId));
      const payload = job ?? { error: "Job not found" };
      return {
        content: JSON.stringify(payload),
        event: event(runId, "agent_job_status", job ? `${job.kind} ${job.status}` : "Job not found", undefined, payload),
      };
    }
    case "coding_session_start": {
      if (!ctx.databases) {
        return {
          content: JSON.stringify({ error: "Coding sessions are unavailable in this turn." }),
          event: event(runId, "error", "Coding session unavailable"),
        };
      }
      const priorJob = await findLatestJobForRun(ctx.databases, ctx.userId, runId, "coding_session");
      const priorAuthFail = Boolean(
        priorJob?.status === "failed" && isAzureSandboxAccessError(priorJob.error || ""),
      );
      // #region agent log
      agentDebugLog({
        hypothesisId: "I",
        location: "tools.ts:coding_session_start",
        message: "coding_session_start invoked",
        data: {
          priorAuthFail,
          priorJobStatus: priorJob?.status || null,
          priorAadsts: String(priorJob?.error || "").match(/AADSTS\d+/)?.[0] || null,
          repoId: asString(parsed.repoId) || null,
        },
      });
      // #endregion
      if (priorAuthFail && sandboxDriverKind() === "azure") {
        // The last attempt in this run hit a tenant/role problem. Re-check Azure live so a fix
        // (new env, new role assignment) is honoured immediately, and a still-broken setup
        // returns the exact manual step instead of burning another sandbox create.
        const probe = await probeAzureSandboxAccess();
        if (!probe.ok) {
          const payload = {
            error: probe.error,
            jobId: priorJob?.id,
            retryable: false,
            blocked: true,
            code: azureSandboxFailureCode(probe.error) || "AZURE_SANDBOX_ACCESS",
            hint: "Tell the user the manual step above verbatim. Do not call coding_session_start again in this turn; they can say retry once Azure is fixed.",
          };
          return {
            content: JSON.stringify(payload),
            event: event(runId, "error", "Azure sandbox access failed", payload.error, payload),
          };
        }
      }
      const workItemId = asString(parsed.workItemId);
      const plugins = ctx.plugins ?? harness.plugins;
      const job = await createAgentJob(ctx.databases, {
        userId: ctx.userId,
        runId,
        kind: "coding_session",
        payload: {
          workItemId,
          repoId: asString(parsed.repoId) || undefined,
          projectId: ctx.projectId,
          baseBranch: asString(parsed.baseBranch) || undefined,
          exposePort: typeof parsed.exposePort === "number" ? parsed.exposePort : undefined,
          autoMode: ctx.harness?.settings.autonomousCoding === true || ctx.permissionType === "all_access",
        },
      });
      if (job) {
        scheduleAgentJob({
          databases: ctx.databases,
          userId: ctx.userId,
          jobId: job.id,
          context,
          plugins,
          mcp,
          mcpAuth: ctx.mcpAuth,
          harness,
          projectId: ctx.projectId,
          workspaceId: ctx.workspaceId,
        });
        const finished = await waitForAgentJob(ctx.databases, ctx.userId, job.id, 240_000);
        if (finished?.status === "completed" && finished.result) {
          const result = finished.result;
          const preview = describeCodingPreview({
            previewUrl: typeof result.previewUrl === "string" ? result.previewUrl : undefined,
            driver: typeof result.driver === "string" ? result.driver : sandboxDriverKind(),
            status: typeof result.status === "string" ? result.status : "running",
            sandboxId: typeof result.sandboxId === "string" ? result.sandboxId : undefined,
            previewLive: result.previewLive === true,
          });
          const payload = { ...result, jobId: job.id, previewLive: preview.live, previewStub: preview.stub, note: preview.note };
          return {
            content: JSON.stringify(payload),
            event: event(
              runId,
              "coding_session_start",
              preview.live ? "Coding session preview ready" : preview.stub ? "Coding session started (stub preview)" : "Coding session started",
              workItemId,
              payload,
            ),
            missingCapability: githubPauseCapability(hasGithubAccount(context), result),
          };
        }
        if (finished?.status === "failed") {
          const err = finished.error || "Coding session job failed";
          const access = isAzureSandboxAccessError(err);
          const payload = {
            error: err,
            jobId: job.id,
            retryable: !access,
            code: azureSandboxFailureCode(err) || undefined,
            ...(access
              ? {
                  hint: "Azure access problem, not a code problem. Give the user the manual step verbatim, do not retry coding_session_start in this turn, and do not fall back to direct GitHub writes or GitHub Pages as a preview.",
                }
              : { hint: "Transient sandbox failure. Retry coding_session_start once; if it fails again, report the error." }),
          };
          return {
            content: JSON.stringify(payload),
            event: event(runId, "error", "Coding session failed", payload.error, payload),
          };
        }
        const payload = {
          jobId: job.id,
          status: finished?.status || job.status,
          workItemId,
          note: "Sandbox is still preparing. Call coding_session_status for sandboxId and previewUrl before writing code.",
        };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "coding_session_start", "Queued coding session", workItemId, payload),
        };
      }
      try {
        const result = await startOrResumeCodingSession({
          databases: ctx.databases,
          userId: ctx.userId,
          runId,
          context,
          harness,
          plugins,
          workItemId,
          projectId: ctx.projectId,
          repoId: asString(parsed.repoId) || undefined,
          baseBranch: asString(parsed.baseBranch) || undefined,
          exposePort: typeof parsed.exposePort === "number" ? parsed.exposePort : undefined,
          autoMode: ctx.harness?.settings.autonomousCoding === true || ctx.permissionType === "all_access",
        });
        const failed = "error" in result;
        const preview = describeCodingPreview({
          previewUrl: typeof result.previewUrl === "string" ? result.previewUrl : undefined,
          driver: typeof result.driver === "string" ? result.driver : sandboxDriverKind(),
          status: typeof result.status === "string" ? result.status : undefined,
          previewLive: result.previewLive === true,
          sandboxId: typeof result.sandboxId === "string" ? result.sandboxId : undefined,
        });
        const payload = failed ? result : { ...result, previewLive: preview.live, previewStub: preview.stub, note: preview.note };
        return {
          content: JSON.stringify(payload),
          event: event(
            runId,
            failed ? "error" : "coding_session_start",
            failed ? "Coding session failed" : preview.live ? "Coding session preview ready" : "Coding session started",
            workItemId,
            payload,
          ),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Coding session failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Coding session failed", payload.error, payload),
        };
      }
    }
    case "coding_session_exec": {
      if (!ctx.databases) {
        return {
          content: JSON.stringify({ error: "Coding sessions are unavailable in this turn." }),
          event: event(runId, "error", "Sandbox exec unavailable"),
        };
      }
      const command = asString(parsed.command);
      const session =
        (asString(parsed.sessionId) ? await getCodingSession(ctx.databases, asString(parsed.sessionId)) : null) ??
        (await findCodingSessionByRun(ctx.databases, runId));
      if (!session?.sandboxId) {
        const payload = { error: "No sandbox is bound. Call coding_session_start first." };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "No coding session sandbox", payload.error, payload),
        };
      }
      try {
        const result = await getSandboxDriver().exec(session.sandboxId, command, asString(parsed.cwd) || "/workspace");
        await updateCodingSession(ctx.databases, session.id, {
          events: appendSessionEvent(session.events, "exec", redactSecrets(command), {
            exitCode: result.exitCode,
          }),
        });
        const payload = {
          sessionId: session.id,
          command: redactSecrets(command),
          stdout: result.stdout.slice(0, 8000),
          stderr: result.stderr.slice(0, 2000),
          exitCode: result.exitCode,
        };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "coding_session_exec", command, result.stdout.slice(0, 400), payload),
        };
      } catch (error) {
        if (isSandboxGoneError(error)) {
          const restarted = await startOrResumeCodingSession({
            databases: ctx.databases,
            userId: ctx.userId,
            runId,
            context,
            harness,
            plugins: ctx.plugins ?? harness.plugins,
            workItemId: session.workItemId,
            projectId: ctx.projectId || session.projectId,
            repoId: session.repoId,
            baseBranch: session.baseBranch,
            autoMode: ctx.harness?.settings.autonomousCoding === true || ctx.permissionType === "all_access",
          });
          if ("error" in restarted || !restarted.sandboxId) {
            const err = "error" in restarted ? String(restarted.error) : error instanceof Error ? error.message : "Sandbox gone";
            const present = sandboxSessionFailurePresentation(err);
            const payload = {
              error: err,
              retryable: true,
              code: present.code,
              hint: present.hint,
            };
            return {
              content: JSON.stringify(payload),
              event: event(runId, "error", present.title, payload.error, payload),
            };
          }
          const result = await getSandboxDriver().exec(
            String(restarted.sandboxId),
            command,
            asString(parsed.cwd) || "/workspace",
          );
          const payload = {
            sessionId: restarted.sessionId,
            sandboxId: restarted.sandboxId,
            recreated: true,
            command: redactSecrets(command),
            stdout: result.stdout.slice(0, 8000),
            stderr: result.stderr.slice(0, 2000),
            exitCode: result.exitCode,
          };
          return {
            content: JSON.stringify(payload),
            event: event(runId, "coding_session_exec", command, result.stdout.slice(0, 400), payload),
          };
        }
        const payload = { error: error instanceof Error ? error.message : "Sandbox exec failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Sandbox exec failed", payload.error, payload),
        };
      }
    }
    case "coding_session_status": {
      if (!ctx.databases) {
        return {
          content: JSON.stringify({ error: "Coding sessions are unavailable in this turn." }),
          event: event(runId, "error", "Session status unavailable"),
        };
      }
      const session =
        (asString(parsed.sessionId) ? await getCodingSession(ctx.databases, asString(parsed.sessionId)) : null) ??
        (await findCodingSessionByRun(ctx.databases, runId)) ??
        (asString(parsed.workItemId)
          ? await findActiveCodingSessionForWorkItem(ctx.databases, asString(parsed.workItemId))
          : null);
      const job =
        !session?.sandboxId
          ? await findLatestJobForRun(ctx.databases, ctx.userId, runId, "coding_session")
          : null;
      if (session?.sandboxId && typeof parsed.exposePort === "number" && parsed.exposePort > 0 && !session.previewUrl) {
        try {
          const previewUrl = await getSandboxDriver().exposePort(session.sandboxId, parsed.exposePort);
          const updated = await updateCodingSession(ctx.databases, session.id, { previewUrl });
          const preview = describeCodingPreview({
            previewUrl,
            driver: session.driver || sandboxDriverKind(),
            status: updated?.status ?? session.status,
            sandboxId: session.sandboxId,
            previewLive: session.previewLive,
          });
          const next = {
            sessionId: session.id,
            status: updated?.status ?? session.status,
            sandboxId: session.sandboxId,
            previewUrl,
            prUrl: session.prUrl,
            driver: preview.driver,
            previewLive: preview.live,
            previewStub: preview.stub,
            note: preview.note,
          };
          return {
            content: JSON.stringify(next),
            event: event(runId, "coding_session_status", `${session.status} · preview`, session.headBranch, next),
          };
        } catch (error) {
          const fail = { error: error instanceof Error ? error.message : "Failed to expose preview port" };
          return {
            content: JSON.stringify(fail),
            event: event(runId, "error", "Preview port failed", fail.error, fail),
          };
        }
      }
      const preview = describeCodingPreview({
        previewUrl: session?.previewUrl,
        driver: session?.driver || sandboxDriverKind(),
        status: session?.status,
        sandboxId: session?.sandboxId,
        previewLive: session?.previewLive,
      });
      const payload = session
        ? {
            sessionId: session.id,
            status: session.status,
            sandboxId: session.sandboxId,
            previewUrl: session.previewUrl,
            prUrl: session.prUrl,
            headBranch: session.headBranch,
            driver: preview.driver,
            previewLive: preview.live,
            previewStub: preview.stub,
            codingAgent: session.codingAgent,
            codingAgentReason: session.codingAgentReason,
            artifacts: session.artifacts,
            note: preview.note,
            job: job
              ? { jobId: job.id, status: job.status, progress: job.progress, error: job.error }
              : undefined,
          }
        : job
          ? {
              error: "Session not found yet",
              jobId: job.id,
              status: job.status,
              progress: job.progress,
              errorDetail: job.error,
              note: "Sandbox job is still queued or running. Poll again until sandboxId is set.",
            }
          : { error: "Session not found" };
      return {
        content: JSON.stringify(payload),
        event: event(
          runId,
          "coding_session_status",
          session ? `${session.status}${session.previewUrl ? ` · preview` : ""}` : job ? `job ${job.status}` : "Session not found",
          session?.headBranch,
          payload,
        ),
      };
    }
    case "coding_session_implement": {
      if (!ctx.databases) {
        return {
          content: JSON.stringify({ error: "Coding sessions are unavailable in this turn." }),
          event: event(runId, "error", "Sandbox implement unavailable"),
        };
      }
      const session =
        (asString(parsed.sessionId) ? await getCodingSession(ctx.databases, asString(parsed.sessionId)) : null) ??
        (await findCodingSessionByRun(ctx.databases, runId));
      let sandboxId = session?.sandboxId;
      if (!sandboxId || !(await sandboxIsAlive(getSandboxDriver(), sandboxId))) {
        const workItemId = session?.workItemId || asString(parsed.workItemId);
        if (!workItemId) {
          const payload = { error: "No sandbox is bound. Call coding_session_start first." };
          return {
            content: JSON.stringify(payload),
            event: event(runId, "error", "No coding session sandbox", payload.error, payload),
          };
        }
        const restarted = await startOrResumeCodingSession({
          databases: ctx.databases,
          userId: ctx.userId,
          runId,
          context,
          harness,
          plugins: ctx.plugins ?? harness.plugins,
          workItemId,
          projectId: ctx.projectId || session?.projectId,
          repoId: session?.repoId,
          autoMode: ctx.harness?.settings.autonomousCoding === true || ctx.permissionType === "all_access",
        });
        if ("error" in restarted || !restarted.sandboxId) {
          const err = "error" in restarted ? String(restarted.error) : "No sandbox is bound. Call coding_session_start first.";
          const present = sandboxSessionFailurePresentation(err);
          const payload = {
            error: err,
            retryable: true,
            code: present.code,
            hint: present.hint,
          };
          return {
            content: JSON.stringify(payload),
            event: event(runId, "error", present.title, payload.error, payload),
          };
        }
        sandboxId = String(restarted.sandboxId);
      }
      const boundSession =
        session ?? (await findCodingSessionByRun(ctx.databases, runId));
      if (!boundSession) {
        const payload = { error: "No sandbox is bound. Call coding_session_start first." };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "No coding session sandbox", payload.error, payload),
        };
      }
      const agent = resolveSandboxCodingAgent();
      const prompt =
        asString(parsed.prompt || parsed.task) ||
        ctx.latestUserText ||
        "Implement the accepted implementation plan in /workspace. Do not push until tests pass.";
      if (!agent.available) {
        const payload = {
          error: agent.reason,
          fallback: "specialists",
          codingAgent: agent.id,
          sessionId: boundSession.id,
          note: "Fairlx specialists may coding_session_exec in /workspace. They must not github_write_file while this sandbox is bound.",
        };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "coding_session_implement", "Claude Code / Codex unavailable", payload.error, payload),
        };
      }
      try {
        const command = sandboxImplementShell(agent, prompt);
        const result = await getSandboxDriver().exec(sandboxId, command, "/workspace");
        const secretValues = Object.values(agent.env);
        await updateCodingSession(ctx.databases, boundSession.id, {
          events: appendSessionEvent(
            boundSession.events,
            "implement",
            redactSecrets(result.stdout.slice(0, 800), secretValues),
            {
              codingAgent: agent.id,
              exitCode: result.exitCode,
            },
          ),
          meta: { ...boundSession.meta, codingAgent: agent.id, codingAgentReason: agent.reason },
        });
        const payload = {
          sessionId: boundSession.id,
          codingAgent: agent.id,
          stdout: redactSecrets(result.stdout, secretValues).slice(0, 8000),
          stderr: redactSecrets(result.stderr, secretValues).slice(0, 2000),
          exitCode: result.exitCode,
        };
        return {
          content: JSON.stringify(payload),
          event: event(
            runId,
            "coding_session_implement",
            `${agent.id} in sandbox`,
            redactSecrets(result.stdout.slice(0, 400), secretValues),
            payload,
          ),
        };
      } catch (error) {
        if (isSandboxGoneError(error)) {
          const payload = {
            error: error instanceof Error ? error.message : "Sandbox gone",
            codingAgent: agent.id,
            retryable: true,
            code: "sandbox_gone",
            hint: "Call coding_session_start. Fairlx will create a new sandbox. Do not github_write_file.",
          };
          return {
            content: JSON.stringify(payload),
            event: event(runId, "error", "Sandbox was deleted", payload.error, payload),
          };
        }
        const payload = {
          error: error instanceof Error ? error.message : "Sandbox coding agent failed",
          codingAgent: agent.id,
        };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Sandbox coding agent failed", payload.error, payload),
        };
      }
    }
    case "coding_session_browser": {
      if (!ctx.databases) {
        return {
          content: JSON.stringify({ error: "Coding sessions are unavailable in this turn." }),
          event: event(runId, "error", "Sandbox browser unavailable"),
        };
      }
      const session =
        (asString(parsed.sessionId) ? await getCodingSession(ctx.databases, asString(parsed.sessionId)) : null) ??
        (await findCodingSessionByRun(ctx.databases, runId));
      if (!session?.sandboxId) {
        const payload = { error: "No sandbox is bound. Call coding_session_start first." };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "No coding session sandbox", payload.error, payload),
        };
      }
      const port = session.meta?.exposePort || 3000;
      try {
        const shot = await captureSandboxPreview({
          driver: getSandboxDriver(),
          sandboxId: session.sandboxId,
          port,
        });
        const artifacts = [...(session.artifacts ?? []), ...shot.artifacts].slice(-8);
        const meta = { ...session.meta, artifacts };
        await updateCodingSession(ctx.databases, session.id, {
          events: withSessionMeta(appendSessionEvent(session.events, "screenshot", shot.log.slice(0, 500), { artifacts }), meta),
          meta,
          artifacts,
        });
        const payload = {
          sessionId: session.id,
          artifacts,
          log: shot.log.slice(0, 1500),
          note: shot.artifacts.length
            ? "Screenshot captured in the sandbox browser."
            : "No Chromium in this image. Use the Preview tab iframe of the live Azure URL as the in-app browser.",
        };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "coding_session_browser", payload.note, shot.log.slice(0, 400), payload),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Sandbox browser failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Sandbox browser failed", payload.error, payload),
        };
      }
    }
    case "github_merge_pr": {
      try {
        const result = await githubMergePullRequest({
          databases: ctx.databases,
          context,
          plugins: ctx.plugins ?? harness.plugins,
          pullNumber: Number(parsed.pullNumber),
          repoId: asString(parsed.repoId) || undefined,
          projectId: ctx.projectId,
          commitTitle: asString(parsed.commitTitle) || undefined,
          mergeMethod:
            parsed.mergeMethod === "merge" || parsed.mergeMethod === "rebase" || parsed.mergeMethod === "squash"
              ? parsed.mergeMethod
              : "squash",
        });
        if (ctx.databases && !("error" in result)) {
          const session = await findCodingSessionByRun(ctx.databases, runId);
          if (session) {
            await updateCodingSession(ctx.databases, session.id, {
              status: "merged",
              events: appendSessionEvent(session.events, "merged", `Merged PR #${parsed.pullNumber}`),
            });
          }
        }
        const failed = "error" in result;
        return {
          content: JSON.stringify(result),
          event: event(
            runId,
            failed ? "error" : "github_merge_pr",
            failed ? "Merge failed" : `Merged PR #${parsed.pullNumber}`,
            undefined,
            result,
          ),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Merge failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Merge failed", payload.error, payload),
        };
      }
    }
    case "github_request_reviewers": {
      try {
        const reviewers = Array.isArray(parsed.reviewers)
          ? parsed.reviewers.map((item) => String(item)).filter(Boolean)
          : [];
        const result = await githubRequestReviewers({
          databases: ctx.databases,
          context,
          plugins: ctx.plugins ?? harness.plugins,
          pullNumber: Number(parsed.pullNumber),
          reviewers,
          repoId: asString(parsed.repoId) || undefined,
          projectId: ctx.projectId,
        });
        return {
          content: JSON.stringify(result),
          event: event(runId, "github_request_reviewers", `Requested reviewers on PR #${parsed.pullNumber}`, undefined, result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Request reviewers failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Request reviewers failed", payload.error, payload),
        };
      }
    }
    case "github_update_repo": {
      try {
        const result = await githubUpdateRepo({
          databases: ctx.databases,
          context,
          plugins: ctx.plugins ?? harness.plugins,
          repoId: asString(parsed.repoId) || undefined,
          owner: asString(parsed.owner) || undefined,
          repo: asString(parsed.repo) || undefined,
          projectId: ctx.projectId,
          private: typeof parsed.private === "boolean" ? parsed.private : parsed.visibility === "private" ? true : parsed.visibility === "public" ? false : undefined,
          description: asString(parsed.description) || undefined,
          homepage: asString(parsed.homepage) || undefined,
        });
        const failed = "error" in result;
        const fullName = "fullName" in result ? result.fullName : "";
        return {
          content: JSON.stringify(result),
          event: event(
            runId,
            failed ? "error" : "github_update_repo",
            failed ? "Update GitHub repository failed" : `Updated ${fullName || "repository"}`,
            "private" in result ? (result.private ? "private" : "public") : undefined,
            result,
          ),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Update GitHub repository failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Update GitHub repository failed", payload.error, payload),
          missingCapability: githubPauseCapability(hasGithubAccount(context), payload),
        };
      }
    }
    case "github_delete_file": {
      try {
        const result = await githubDeleteFile({
          databases: ctx.databases,
          context,
          plugins: ctx.plugins ?? harness.plugins,
          path: asString(parsed.path),
          message: asString(parsed.message) || undefined,
          branch: asString(parsed.branch) || undefined,
          repoId: asString(parsed.repoId) || undefined,
          owner: asString(parsed.owner) || undefined,
          repo: asString(parsed.repo) || undefined,
          projectId: ctx.projectId,
        });
        const failed = "error" in result;
        return {
          content: JSON.stringify(result),
          event: event(
            runId,
            failed ? "error" : "github_delete_file",
            failed ? "GitHub delete failed" : `Deleted ${asString(parsed.path)}`,
            asString(parsed.path) || undefined,
            { ...result, path: asString(parsed.path) },
          ),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "GitHub delete failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "GitHub delete failed", payload.error, payload),
          missingCapability: githubPauseCapability(hasGithubAccount(context), payload),
        };
      }
    }
    case "github_list_prs": {
      try {
        const result = await githubListPullRequests({
          databases: ctx.databases,
          context,
          plugins: ctx.plugins ?? harness.plugins,
          state: asString(parsed.state) as "open" | "closed" | "all" | undefined,
          repoId: asString(parsed.repoId) || undefined,
          owner: asString(parsed.owner) || undefined,
          repo: asString(parsed.repo) || undefined,
          projectId: ctx.projectId,
        });
        const failed = "error" in result;
        return {
          content: JSON.stringify(result),
          event: event(runId, failed ? "error" : "github_list_prs", failed ? "List pull requests failed" : "Listed pull requests", undefined, result),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "List pull requests failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "List pull requests failed", payload.error, payload),
        };
      }
    }
    case "github_list_issues": {
      try {
        const result = await githubListIssues({
          databases: ctx.databases,
          context,
          plugins: ctx.plugins ?? harness.plugins,
          state: asString(parsed.state) as "open" | "closed" | "all" | undefined,
          repoId: asString(parsed.repoId) || undefined,
          owner: asString(parsed.owner) || undefined,
          repo: asString(parsed.repo) || undefined,
          projectId: ctx.projectId,
        });
        const failed = "error" in result;
        return {
          content: JSON.stringify(result),
          event: event(runId, failed ? "error" : "github_list_issues", failed ? "List issues failed" : "Listed issues", undefined, result),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "List issues failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "List issues failed", payload.error, payload),
        };
      }
    }
    case "github_create_issue": {
      try {
        const result = await githubCreateIssue({
          databases: ctx.databases,
          context,
          plugins: ctx.plugins ?? harness.plugins,
          title: asString(parsed.title),
          body: asString(parsed.body) || undefined,
          labels: Array.isArray(parsed.labels) ? parsed.labels.map((item) => String(item)).filter(Boolean) : undefined,
          repoId: asString(parsed.repoId) || undefined,
          owner: asString(parsed.owner) || undefined,
          repo: asString(parsed.repo) || undefined,
          projectId: ctx.projectId,
        });
        const failed = "error" in result;
        return {
          content: JSON.stringify(result),
          event: event(
            runId,
            failed ? "error" : "github_create_issue",
            failed ? "Create issue failed" : `Opened issue ${"number" in result ? `#${result.number}` : ""}`.trim(),
            asString(parsed.title) || undefined,
            result,
          ),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Create issue failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Create issue failed", payload.error, payload),
        };
      }
    }
    case "github_close_issue": {
      try {
        const result = await githubCloseIssue({
          databases: ctx.databases,
          context,
          plugins: ctx.plugins ?? harness.plugins,
          issueNumber: Number(parsed.issueNumber || parsed.number),
          repoId: asString(parsed.repoId) || undefined,
          owner: asString(parsed.owner) || undefined,
          repo: asString(parsed.repo) || undefined,
          projectId: ctx.projectId,
        });
        const failed = "error" in result;
        return {
          content: JSON.stringify(result),
          event: event(runId, failed ? "error" : "github_close_issue", failed ? "Close issue failed" : `Closed issue #${parsed.issueNumber}`, undefined, result),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Close issue failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Close issue failed", payload.error, payload),
        };
      }
    }
    case "github_comment_issue": {
      try {
        const result = await githubCommentIssue({
          databases: ctx.databases,
          context,
          plugins: ctx.plugins ?? harness.plugins,
          issueNumber: Number(parsed.issueNumber || parsed.number),
          body: asString(parsed.body),
          repoId: asString(parsed.repoId) || undefined,
          owner: asString(parsed.owner) || undefined,
          repo: asString(parsed.repo) || undefined,
          projectId: ctx.projectId,
        });
        const failed = "error" in result;
        return {
          content: JSON.stringify(result),
          event: event(runId, failed ? "error" : "github_comment_issue", failed ? "Issue comment failed" : `Commented on #${parsed.issueNumber}`, undefined, result),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "Issue comment failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "Issue comment failed", payload.error, payload),
        };
      }
    }
    case "github_list_branches": {
      try {
        const result = await githubListBranches({
          databases: ctx.databases,
          context,
          plugins: ctx.plugins ?? harness.plugins,
          repoId: asString(parsed.repoId) || undefined,
          owner: asString(parsed.owner) || undefined,
          repo: asString(parsed.repo) || undefined,
          projectId: ctx.projectId,
        });
        const failed = "error" in result;
        return {
          content: JSON.stringify(result),
          event: event(runId, failed ? "error" : "github_list_branches", failed ? "List branches failed" : "Listed branches", undefined, result),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "List branches failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "List branches failed", payload.error, payload),
        };
      }
    }
    case "github_list_releases": {
      try {
        const result = await githubListReleases({
          databases: ctx.databases,
          context,
          plugins: ctx.plugins ?? harness.plugins,
          repoId: asString(parsed.repoId) || undefined,
          owner: asString(parsed.owner) || undefined,
          repo: asString(parsed.repo) || undefined,
          projectId: ctx.projectId,
        });
        const failed = "error" in result;
        return {
          content: JSON.stringify(result),
          event: event(runId, failed ? "error" : "github_list_releases", failed ? "List releases failed" : "Listed releases", undefined, result),
          missingCapability: githubPauseCapability(hasGithubAccount(context), result),
        };
      } catch (error) {
        const payload = { error: error instanceof Error ? error.message : "List releases failed" };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "error", "List releases failed", payload.error, payload),
        };
      }
    }
    case "page_ui": {
      const parsedAction = parsePageUiAction(parsed);
      if (!parsedAction.ok) {
        const payload = { ok: false, error: parsedAction.error };
        return {
          content: JSON.stringify(payload),
          event: event(runId, "page_ui", "Page UI action failed", parsedAction.error, payload),
        };
      }
      const payload = {
        ok: true,
        ...parsedAction.value,
        instruction: "The open Fairlx page will apply this view change. Do not claim it failed.",
      };
      return {
        content: JSON.stringify(payload),
        event: event(runId, "page_ui", pageUiEventTitle(parsedAction.value), undefined, payload),
      };
    }
    case "ask_user": {
      const payload = {
        error: "ask_user pauses the turn until the user answers. Do not retry this tool.",
      };
      return {
        content: JSON.stringify(payload),
        event: event(runId, "ask_user", "Waiting for an answer", undefined, payload),
      };
    }
    default: {
      const payload = { name, args: parsed };
      return {
        content: JSON.stringify({ error: `Unknown tool: ${name}` }),
        event: event(runId, "error", `Unknown tool: ${name}`, undefined, payload),
      };
    }
  }
}
