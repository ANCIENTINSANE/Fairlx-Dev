import type { Databases } from "node-appwrite";

import {
  DEEPSEEK_FLASH_MODEL_ID,
  DEEPSEEK_PRO_MODEL_ID,
  FOUNDRY_GPT_LUNA_MODEL_ID,
  GROK_46_MODEL_ID,
  getPlatformDefaultModelId,
  isPlatformGrokEnabled,
  resolveExtraFoundrySpec,
} from "../constants";
import type {
  AgentAiConfigStored,
  AgentCapability,
  AgentChatMessage,
  AgentHarness,
  AgentPermissionType,
  AgentRun,
  AgentSpecialistId,
  AgentToolCall,
  AgentToolEvent,
  McpConfig,
} from "../types";
import { buildAgentMcpAuth, mcpToolsForAuth } from "./agent-auth";
import { loadAgentContext } from "./context";
import { getOrCreateHarness, upsertHarness } from "./harness";
import { ensurePersonalMcp } from "./mcp-bridge";
import { compileFairlxListIntent } from "./intent-compiler";
import { extractToolCallsFromText, mergeToolCalls, normalizeAgentToolCall, stripToolCallMarkup } from "./parse-tool-calls";
import { displayUserContent, isPersonalSessionMode, trainingSaveReady } from "./session-context";
import { fromResponsesResponse, isResponsesResponse, stripUnsupportedSamplingParams, toResponsesRequest } from "./openai-responses";
import type { AgentLlmApi } from "./openai-responses";
import {
  getPlatformProviderCredentials,
  normalizeAzureFoundryBaseUrl,
  overlayPlatformModel,
} from "./platform-credentials";
import { buildSystemPrompt } from "./prompt";
import { isTrainingKickoffContent, isTrainingRun, profileIsTrained } from "./personal-training";
import { getAiDocument, getMcpDocument, parseAiConfig, parseMcpConfig } from "./store";
import { decryptSecret } from "./secrets";
import {
  canonicalizeToolCall,
  coalescedListMessage,
  collapseWorkItemListFanOut,
  collapseRedundantReadFanOut,
  SKIPPED_WORK_ITEM_GET,
  SKIPPED_WEB_FETCH,
  fingerprintsFromMessages,
  hydrateListSliceCache,
  isFailedToolContent,
  rememberListSlice,
  repeatedToolMessage,
  shouldForceAnswer,
  resolveListSliceCall,
  forgetListCachesAfterMutation,
  toolCallFingerprint,
  unwrapListCall,
  toolsWhenContextIsTight,
} from "./tool-loop";
import { parseAskUserArgs } from "./ask-user";
import { askUserTool, executeTool, failedToolResult, openaiToolsForTurn, trainingSaveTool, type OpenAiTool } from "./tools";
import { compactJsonString } from "./truncate";
import { getRun, listRuns, updateRun } from "./runs";
import { getPersonalAgent } from "./personal-agent-store";
import { AGENT_CHAT_TIMEOUT_MS, formatAgentTurnError, isContextLengthError, modelHttpError, withTransientFetchRetry } from "./turn-errors";
import { sanitizeAssistantVisible } from "./visible-content";
import { extractBoardProjectFromTool } from "./project-launch";
import { specialistById } from "./graph";
import { buildSpecialistUserMessage, extractAttachedFiles, parentPromptFromMessages, subjectsFromFiles } from "./attachments";
import { hasGithubAccount, hasProjectGithubRepo, projectGithubRepos } from "./github-scope";
import { githubLinkRepo } from "../plugins/github";
import {
  parseGithubAttachRequest,
  pendingGithubOwnerChoice,
  matchGithubOwnerReply,
  githubCreateRepoArgsFromOwnerChoice,
  conversationWantsGithubCreateRepo,
  conversationWantsGithubVisibility,
  latestGithubRepoRef,
  mergeProjectGithubRepo,
} from "../plugins/github-helpers";
import { capSpecialistResult, CONTEXT_BUDGET_RATIO, estimatedFittedTokens, factsFromTurn, filterToolsForSpecialist, fitMessagesForModel, mergeStateKnowledge, selectToolsForTurn } from "./brain";
import { catalogForCapability, isGithubCapability, missingCapabilities } from "../plugins/catalog";
import { claimQueuedJobs } from "./jobs";
import { scheduleAgentJob } from "./schedule-job";
import {
  activeSubagents,
  buildContextMeterPayload,
  latestContextMeter,
  takeHigherChatPeak,
} from "./context-meter";
import { buildAgentLlmUsageEvent, recordAgentChatUsage } from "./ai-usage-billing";
import {
  MAX_PARALLEL_SUBAGENTS,
  chunkForParallel,
  createMergedEventPersister,
  fanOutDelegatesForSubjects,
  groupParallelizable,
} from "./parallel-work";
import {
  confirmationSummary,
  conversationDeleteIntent,
  DESTRUCTIVE_NOT_REQUESTED_MESSAGE,
  findPendingConfirmation,
  isDestructiveToolCall,
  isWriteToolCall,
  needsConfirmation,
} from "./write-guard";
import { hasRequiredWebResearch, seedDocTurnLimitsFromMessages } from "./doc-turn-limits";
import {
  applyPlanProgressFromTool,
  blockedBuildGateResult,
  blockedErrorDumpResult,
  blockedSandboxWaitResult,
  buildGateShouldBlock,
  codingSessionArgsFromPlan,
  compactImplementationPlan,
  conversationLooksLikeError,
  filterCallsForBuildGate,
  filterCallsForErrorDump,
  filterCallsUntilSandbox,
  parseImplementationPlan,
  planIsAccepted,
  resolveRunImplementationPlan,
  runHasAcceptedPlan,
  runIsWaitingForSandbox,
  shouldUseInspectModel,
} from "./implementation-plan";
import {
  blockedSandboxAuthResult,
  filterCallsForFailedSandboxAuth,
  isNonRetryableAzureAuthError,
  rewriteSandboxAuthAssistantContent,
  runHasNonRetryableSandboxAuth,
} from "./sandbox/azure";
import { agentDebugLog } from "./sandbox/debug-log";

const MAX_TOOL_ITERATIONS = 48;
const MAX_SPECIALIST_ITERATIONS = 16;
const cancelledRuns = new Set<string>();

export function cancelAgentTurn(runId: string) {
  cancelledRuns.add(runId);
}

export function isAgentTurnCancelled(runId: string) {
  return cancelledRuns.has(runId);
}

function thoughtEvent(runId: string, title: string, detail?: string, payload?: unknown): AgentToolEvent {
  return {
    id: crypto.randomUUID(),
    type: "thought",
    title,
    detail,
    payload,
    createdAt: new Date().toISOString(),
    runId,
  };
}

function attachSubagent(event: AgentToolEvent, subagentId: string, specialist: string): AgentToolEvent {
  const payload =
    event.payload && typeof event.payload === "object" ? { ...(event.payload as Record<string, unknown>) } : {};
  return {
    ...event,
    payload: {
      ...payload,
      id: typeof payload.id === "string" && payload.id ? payload.id : subagentId,
      subagentId,
      specialist,
    },
  };
}

function withContextMeter(params: {
  events: AgentToolEvent[];
  runId: string;
  system: string;
  tools: OpenAiTool[];
  messages: AgentChatMessage[];
  harness: AgentHarness;
  mcp: McpConfig;
  maxInputTokens: number;
}): AgentToolEvent[] {
  const payload = buildContextMeterPayload({
    system: params.system,
    tools: params.tools,
    messages: params.messages,
    harness: params.harness,
    mcp: params.mcp,
    maxInputTokens: params.maxInputTokens,
    subagents: activeSubagents(params.events).length,
  });
  return [
    ...params.events.filter((event) => event.type !== "context_meter"),
    {
      id: crypto.randomUUID(),
      type: "context_meter",
      title: "Context",
      payload,
      createdAt: new Date().toISOString(),
      runId: params.runId,
    },
  ];
}

function chatHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

export type ChatTarget = {
  url: string;
  headers: Record<string, string>;
  model: string;
  modelId: string;
  displayName?: string;
  maxOutputTokens?: number;
  maxInputTokens?: number;
  isPlatform?: boolean;
  api?: AgentLlmApi;
};

function withParallelToolCalls(body: Record<string, unknown>): Record<string, unknown> {
  const tools = body.tools;
  if (!Array.isArray(tools) || tools.length === 0) return body;
  return { ...body, parallel_tool_calls: true };
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

function defaultByokBase(provider: string): string {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "xai":
      return "https://api.x.ai/v1";
    case "ollama":
      return "http://localhost:11434/v1";
    case "google":
      return "https://generativelanguage.googleapis.com/v1beta/openai";
    default:
      return "";
  }
}

export function resolveChatTarget(stored: AgentAiConfigStored): ChatTarget {
  const models = stored.models.map(overlayPlatformModel);
  const defaultModelId = getPlatformDefaultModelId();
  const selectedId =
    stored.mode === "auto" || !stored.selectedModelId ? defaultModelId : stored.selectedModelId;
  const model =
    models.find((item) => item.id === selectedId && item.isEnabled) ??
    (isPlatformGrokEnabled() ? models.find((item) => item.id === GROK_46_MODEL_ID && item.isEnabled) : undefined) ??
    models.find((item) => item.id === DEEPSEEK_FLASH_MODEL_ID && item.isEnabled) ??
    models.find((item) => item.isEnabled) ??
    models[0];
  if (!model) throw new Error("No AI model is configured.");
  const provider = stored.providers.find((item) => item.id === model.providerId);
  if (!provider) throw new Error("Selected model has no provider.");

  if (provider.isPlatform) {
    const creds = getPlatformProviderCredentials(provider.id);
    if (!creds) {
      throw new Error(`Platform credentials are not configured for ${provider.displayName}.`);
    }
    const overlay = resolveExtraFoundrySpec(model.id);
    const userKey = provider.apiKeyEncrypted ? decryptSecret(provider.apiKeyEncrypted) : "";
    const apiKey = overlay?.apiKey || userKey || creds.apiKey;
    if (!apiKey) {
      throw new Error(`Platform credentials are not configured for ${provider.displayName}.`);
    }
    const baseUrl = overlay?.endpoint ? normalizeAzureFoundryBaseUrl(overlay.endpoint) : creds.baseUrl;
    const deployment = overlay?.deployment || model.modelId || creds.deployment;
    return {
      url: joinUrl(baseUrl, `${creds.openaiPath}${creds.api === "responses" ? "/responses" : "/chat/completions"}`),
      headers: {
        "Content-Type": "application/json",
        [creds.authHeader]: apiKey,
      },
      model: deployment,
      maxOutputTokens: model.maxOutputTokens,
      maxInputTokens: model.maxInputTokens,
      modelId: model.id,
      displayName: model.displayName,
      isPlatform: true,
      api: creds.api,
    };
  }

  const apiKey = provider.apiKeyEncrypted ? decryptSecret(provider.apiKeyEncrypted) : "";
  if (!apiKey) {
    throw new Error(`Add an API key for ${provider.displayName} to use this model.`);
  }
  const baseUrl = (provider.baseUrl || defaultByokBase(provider.provider)).replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error(`Set a base URL for ${provider.displayName}.`);
  }
  return {
    url: joinUrl(baseUrl, "/chat/completions"),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    maxOutputTokens: model.maxOutputTokens,
    maxInputTokens: model.maxInputTokens,
    model: model.modelId,
    modelId: model.id,
    displayName: model.displayName,
    isPlatform: false,
  };
}

export function resolveWorkerTarget(stored: AgentAiConfigStored): ChatTarget {
  const flash = stored.models.find((item) => item.id === DEEPSEEK_FLASH_MODEL_ID && item.isEnabled);
  if (flash) {
    try {
      return resolveChatTarget({ ...stored, mode: "manual", selectedModelId: flash.id });
    } catch {
      // fall through
    }
  }
  return resolveChatTarget(stored);
}

export function resolveSessionBuilderTarget(stored: AgentAiConfigStored): ChatTarget {
  const preferred = [
    process.env.AGENT_FOUNDRY_GPT54_AZURE_DEPLOYMENT?.trim() ? "gpt-5.4" : "",
    process.env.AGENT_FOUNDRY_SOL_AZURE_DEPLOYMENT?.trim() ? "gpt-5.6-sol" : "",
    DEEPSEEK_PRO_MODEL_ID,
  ].filter(Boolean);
  for (const id of preferred) {
    const model = stored.models.find((item) => item.id === id && item.isEnabled);
    if (!model) continue;
    try {
      return resolveChatTarget({ ...stored, mode: "manual", selectedModelId: model.id });
    } catch {
      // try next overlay
    }
  }
  return resolveWorkerTarget(stored);
}

export function resolveReviewerTarget(stored: AgentAiConfigStored): ChatTarget {
  const luna = stored.models.find((item) => item.id === FOUNDRY_GPT_LUNA_MODEL_ID && item.isEnabled);
  if (luna) {
    try {
      return resolveChatTarget({ ...stored, mode: "manual", selectedModelId: luna.id });
    } catch {
      // fall through
    }
  }
  return resolveChatTarget(stored);
}

export function resolveOrchestratorTarget(
  stored: AgentAiConfigStored,
  userText: string,
  planAccepted: boolean,
): ChatTarget {
  if (shouldUseInspectModel(userText, planAccepted)) {
    return resolveWorkerTarget(stored);
  }
  return resolveChatTarget(stored);
}

export function specialistChatTarget(
  specialist: AgentSpecialistId,
  targets: { worker: ChatTarget; builder: ChatTarget; reviewer: ChatTarget },
  planAccepted: boolean,
): ChatTarget {
  if (specialist === "builder" || specialist === "git") {
    return planAccepted ? targets.builder : targets.worker;
  }
  if (specialist === "reviewer") return targets.reviewer;
  return targets.worker;
}

type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    item_id?: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

const TRAINING_OPEN_SEED =
  "Begin the training interview now. Greet me by my first name from the system prompt. I have not answered any questions yet. Do not say Hey there or Hi there.";

function toOpenAiMessages(
  system: string,
  messages: AgentChatMessage[],
  options?: { seedTraining?: boolean; maxInputTokens?: number; budgetRatio?: number },
): OpenAiMessage[] {
  const recent = fitMessagesForModel(system, messages, options?.maxInputTokens, options?.budgetRatio);
  const mapped: OpenAiMessage[] = recent
    .filter((message) => !(message.role === "user" && isTrainingKickoffContent(message.content)))
    .map((message) => {
      if (message.role === "assistant") {
        return {
          role: "assistant",
          content: message.content || null,
          tool_calls: message.toolCalls?.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: call.arguments },
            ...(call.itemId ? { item_id: call.itemId } : {}),
          })),
        };
      }
      if (message.role === "tool") {
        return {
          role: "tool",
          content: compactJsonString(message.content ?? "", 4000),
          tool_call_id: message.toolCallId,
          name: message.toolName,
        };
      }
      return { role: "user", content: message.content };
    });
  if (options?.seedTraining && !mapped.some((message) => message.role === "user")) {
    mapped.push({ role: "user", content: TRAINING_OPEN_SEED });
  }
  return [{ role: "system", content: system }, ...mapped];
}

type OpenAiRawToolCall = {
  id?: string;
  item_id?: string;
  name?: string;
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
};

type OpenAiChoiceMessage = {
  content?: string | null | Array<{ type?: string; text?: string }>;
  reasoning_content?: string | null;
  reasoning?: string | null;
  tool_calls?: OpenAiRawToolCall[];
  function_call?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
};

type OpenAiChoice = {
  message?: OpenAiChoiceMessage;
};

type OpenAiChatCompletionResponse = {
  choices?: OpenAiChoice[];
  error?: {
    message?: string;
  };
  message?: string;
  [key: string]: unknown;
};

async function chatCompletion(
  target: ChatTarget,
  body: Record<string, unknown>,
  runId: string,
): Promise<OpenAiChatCompletionResponse> {
  try {
    return await withTransientFetchRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AGENT_CHAT_TIMEOUT_MS);
        const poll = setInterval(() => {
          if (cancelledRuns.has(runId)) controller.abort();
        }, 250);
        try {
          const prepared = withParallelToolCalls(stripUnsupportedSamplingParams(target.model, body));
          const payload = target.api === "responses" ? toResponsesRequest(prepared) : prepared;
          const response = await fetch(target.url, {
            method: "POST",
            headers: target.headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
            cache: "no-store",
          });
          const text = await response.text();
          let json: OpenAiChatCompletionResponse | null = null;
          try {
            json = text ? (JSON.parse(text) as OpenAiChatCompletionResponse) : null;
          } catch {
            json = { error: { message: text } };
          }
          if (!response.ok) {
            const message =
              json?.error?.message || json?.message || `Chat completion failed (${response.status})`;
            throw modelHttpError(message, response.status, response.headers.get("Retry-After"));
          }
          const raw = json ?? {};
          if (target.api === "responses" || isResponsesResponse(raw)) {
            const normalized = fromResponsesResponse(raw);
            if (normalized.error?.message && String((raw as { status?: string }).status || "") === "failed") {
              throw modelHttpError(normalized.error.message, 500);
            }
            return normalized as OpenAiChatCompletionResponse;
          }
          return raw;
        } finally {
          clearTimeout(timer);
          clearInterval(poll);
        }
      },
      { attempts: 5, shouldRetry: () => !cancelledRuns.has(runId) },
    );
  } catch (error) {
    console.error("[agent] chat completion failed", {
      model: target.model,
      host: chatHost(target.url),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function extractMessageContent(message?: OpenAiChoiceMessage): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : String(part?.text ?? "")))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractReasoning(message?: OpenAiChoiceMessage): string {
  for (const value of [message?.reasoning_content, message?.reasoning]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function appendEvents(target: AgentToolEvent[], extra: AgentToolEvent[]) {
  const seen = new Set(target.map((event) => event.id));
  for (const event of extra) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    target.push(event);
  }
  return target;
}

function collectToolCalls(
  choice: OpenAiChoice | undefined,
  mcpToolNames: string[],
  options?: { fromText?: boolean },
): { content: string; toolCalls: AgentToolCall[] } {
  const rawContent = extractMessageContent(choice?.message);
  const native = extractToolCalls(choice).map((call) => normalizeAgentToolCall(call, mcpToolNames));
  const fromText = options?.fromText === false ? [] : extractToolCallsFromText(rawContent, mcpToolNames);
  return {
    content: stripToolCallMarkup(rawContent),
    toolCalls: mergeToolCalls(native, fromText),
  };
}

function extractToolCalls(choice?: OpenAiChoice): AgentToolCall[] {
  const message = choice?.message ?? {};
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (toolCalls.length) {
    return toolCalls
      .map((call: OpenAiRawToolCall) => ({
        id: String(call.id || crypto.randomUUID()),
        ...(typeof call.item_id === "string" && call.item_id.startsWith("fc")
          ? { itemId: call.item_id }
          : {}),
        name: String(call.function?.name || call.name || ""),
        arguments:
          typeof call.function?.arguments === "string"
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments ?? {}),
      }))
      .filter((call: AgentToolCall) => Boolean(call.name));
  }
  if (message.function_call?.name) {
    return [
      {
        id: crypto.randomUUID(),
        name: String(message.function_call.name),
        arguments:
          typeof message.function_call.arguments === "string"
            ? message.function_call.arguments
            : JSON.stringify(message.function_call.arguments ?? {}),
      },
    ];
  }
  return [];
}

function unmatchedToolCalls(run: AgentRun): AgentToolCall[] {
  const lastAssistant = [...run.messages].reverse().find((message) => message.role === "assistant" && message.toolCalls?.length);
  if (!lastAssistant?.toolCalls?.length) return [];
  const answered = new Set(
    run.messages.filter((message) => message.role === "tool" && message.toolCallId).map((message) => message.toolCallId),
  );
  return lastAssistant.toolCalls.filter((call) => !answered.has(call.id));
}

export async function runAgentTurn(params: {
  databases: Databases;
  user: { $id: string; name?: string; email?: string };
  run: AgentRun;
  resume?: { decision: "accept" | "deny" };
}): Promise<AgentRun> {
  const { databases, user, resume } = params;
  let run = params.run;

  cancelledRuns.delete(run.id);

  let snapshotMessages = [...(run.messages ?? [])];
  let snapshotEvents = [...(run.events ?? [])];
  const turnLimits = seedDocTurnLimitsFromMessages(run.messages);

  const persistUnlessStopped = async (
    patch: Parameters<typeof updateRun>[2],
  ): Promise<AgentRun> => {
    if (patch.messages) snapshotMessages = patch.messages;
    if (patch.events) snapshotEvents = patch.events;
    const latest = await getRun(databases, user.$id, run.id);
    const stopped = cancelledRuns.has(run.id) || latest?.status === "stopped";
    if (stopped) {
      return updateRun(databases, run.id, {
        messages: snapshotMessages,
        events: snapshotEvents,
        status: "stopped",
      });
    }
    const meter = latestContextMeter(patch.events ?? run.events);
    const contextPeak = takeHigherChatPeak(
      takeHigherChatPeak(run.contextPeak, latest?.contextPeak),
      meter?.breakdown,
    );
    const plan = run.implementationPlan ?? latest?.implementationPlan;
    const extra = {
      kind:
        latest?.kind === "coding_session" || run.kind === "coding_session"
          ? ("coding_session" as const)
          : latest?.kind === "training" || run.kind === "training"
            ? ("training" as const)
            : (run.kind ?? latest?.kind ?? "chat"),
      sessionId: run.sessionId || latest?.sessionId,
      ...(plan ? { implementationPlan: compactImplementationPlan(plan) } : {}),
      contextPeak,
    };
    const updated = await updateRun(databases, run.id, { ...patch, extra });
    return {
      ...updated,
      messages: patch.messages ?? run.messages,
      events: patch.events ?? updated.events,
      contextPeak,
      sessionId: run.sessionId || extra.sessionId || updated.sessionId,
      implementationPlan: run.implementationPlan ?? extra.implementationPlan ?? updated.implementationPlan,
      kind: extra.kind ?? updated.kind,
    };
  };

  const persistMergedEvents = createMergedEventPersister({
    getEvents: () => snapshotEvents,
    setEvents: (events) => {
      snapshotEvents = events;
    },
    merge: appendEvents,
    persist: (events) => persistUnlessStopped({ events, status: "running" }),
  });

  const haltIfStopped = async (): Promise<AgentRun | null> => {
    const latest = await getRun(databases, user.$id, run.id);
    if (cancelledRuns.has(run.id) || latest?.status === "stopped") {
      return persistUnlessStopped({
        messages: snapshotMessages,
        events: snapshotEvents,
        status: "stopped",
      });
    }
    return null;
  };

  const [initialHarness, loadedContext, mcpDoc, aiDoc, runs, personalProfile] = await Promise.all([
    getOrCreateHarness(databases, user.$id),
    loadAgentContext(databases, user),
    getMcpDocument(databases, user.$id),
    getAiDocument(databases, user.$id),
    listRuns(databases, user.$id, 40),
    getPersonalAgent(databases, user.$id),
  ]);
  let harness = initialHarness;
  let context = loadedContext;
  const permissionType = (): AgentPermissionType =>
    harness.settings.permissionType === "all_access" ? "all_access" : "staged";
  const autonomousCoding = () =>
    harness.settings.autonomousCoding === true ||
    harness.settings.permissionType === "all_access" ||
    run.autonomousCoding === true;
  const mcp = ensurePersonalMcp(parseMcpConfig(mcpDoc?.configJson));
  const stored = parseAiConfig(aiDoc);

  if (
    isPersonalSessionMode(harness.settings.sessionMode) &&
    !isTrainingRun(run) &&
    !profileIsTrained(personalProfile)
  ) {
    return persistUnlessStopped({
      status: "failed",
      error: "Personal Agent is not trained yet. Train or self-train first.",
    });
  }

  const stoppedBeforeModel = await haltIfStopped();
  if (stoppedBeforeModel) return stoppedBeforeModel;

  const lastUserText = displayUserContent(
    [...run.messages].reverse().find((message) => message.role === "user")?.content || run.prompt || "",
  );
  const userTexts = (
    run.messages.some((message) => message.role === "user")
      ? run.messages.filter((message) => message.role === "user").map((message) => displayUserContent(message.content))
      : [lastUserText]
  ).filter(Boolean);
  const intentText = [lastUserText, run.prompt, ...userTexts].filter(Boolean).join("\n");
  const restoredPlan = resolveRunImplementationPlan(run);
  if (restoredPlan) run.implementationPlan = restoredPlan;
  const planAccepted = () => runHasAcceptedPlan(run) || planIsAccepted(run.implementationPlan);
  const buildGateActive = () => buildGateShouldBlock(intentText, lastUserText, planAccepted());
  const sandboxWaitActive = () => planAccepted() && runIsWaitingForSandbox(run);

  let target: ChatTarget;
  let workerTarget: ChatTarget;
  let builderTarget: ChatTarget;
  let reviewerTarget: ChatTarget;
  try {
    workerTarget = resolveWorkerTarget(stored);
    builderTarget = resolveSessionBuilderTarget(stored);
    reviewerTarget = resolveReviewerTarget(stored);
    target = resolveOrchestratorTarget(stored, intentText, planAccepted());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve model.";
    return persistUnlessStopped({ status: "failed", error: message });
  }

  const mcpAuth = await buildAgentMcpAuth({ databases, userId: user.$id, context, run });
  const training = isTrainingRun(run);
  const mcpToolDefs = !training && run.mode === "agent" ? mcpToolsForAuth(mcpAuth) : [];
  const mcpToolNames = mcpToolDefs.map((tool) => tool.name);
  const billingWorkspaceId =
    run.workspaceId || mcpAuth.workspaceId || harness.settings.defaultWorkspaceId || context.workspaces[0]?.id;
  const captureUsage = async (
    completion: unknown,
    chatTarget: ChatTarget,
    operationId: string,
    extra?: { role?: "orchestrator" | "subagent"; specialist?: string; subagentId?: string; iteration?: number },
  ) => {
    const ctx = {
      databases,
      userId: user.$id,
      workspaceId: billingWorkspaceId,
      projectId: run.projectId || mcpAuth.projectId,
      runId: run.id,
      operationId,
      target: chatTarget,
      completion,
      role: extra?.role,
      specialist: extra?.specialist,
      subagentId: extra?.subagentId,
      iteration: extra?.iteration,
    };
    void recordAgentChatUsage(ctx);
    return buildAgentLlmUsageEvent(ctx);
  };

  run = await persistUnlessStopped({
    status: "running",
    modelId: target.modelId,
    error: "",
    events: resume ? run.events : [...run.events, thoughtEvent(run.id, "Working")],
  });
  if (run.status === "stopped") return run;

  const conversationAllowsDelete = conversationDeleteIntent(userTexts).allowed;

  const attachHaystack = [lastUserText, ...userTexts, run.prompt].filter(Boolean).join("\n");
  const wantsGithubAttach = /\b(connect|link|attach)\b/i.test(attachHaystack);
  const attachRef = wantsGithubAttach ? parseGithubAttachRequest(attachHaystack) : undefined;
  if (attachRef && run.projectId && !hasProjectGithubRepo(context, run.projectId)) {
    const linked = await githubLinkRepo({
      databases,
      userId: user.$id,
      projectId: run.projectId,
      owner: attachRef.owner,
      repo: attachRef.repo,
    });
    if ("linked" in linked && linked.linked) {
      context = mergeProjectGithubRepo(context, {
        projectId: run.projectId,
        workspaceId: run.workspaceId || "",
        owner: String(linked.owner),
        repo: String(linked.repo),
        githubUrl: typeof linked.githubUrl === "string" && linked.githubUrl ? linked.githubUrl : undefined,
        branch: String(linked.branch || "main"),
      });
      run = await persistUnlessStopped({
        events: [
          ...run.events,
          {
            id: crypto.randomUUID(),
            type: "github_link_repo",
            title: `Attached ${linked.fullName}`,
            detail: linked.instruction,
            payload: linked,
            createdAt: new Date().toISOString(),
            runId: run.id,
          },
        ],
      });
      if (run.status === "stopped") return run;
    }
  }
  const selectedTools = training
    ? [askUserTool(), ...(trainingSaveReady(run.messages) ? [trainingSaveTool()] : [])]
    : selectToolsForTurn(
        openaiToolsForTurn({
          mode: run.mode,
          enabledTools: harness.settings.enabledTools ?? [],
          mcpTools: mcpToolDefs,
        }),
        [run.prompt, ...userTexts].filter(Boolean).join("\n") || lastUserText,
        {
          hasGithubRepo: hasProjectGithubRepo(context, run.projectId),
          hasGithubAccount: hasGithubAccount(context),
          hasProject: Boolean(
            run.projectId ||
              harness.settings.defaultProjectId ||
              context.projects.some((item) => !run.workspaceId || item.workspaceId === run.workspaceId),
          ),
        },
      );
  const tools =
    !training && isPersonalSessionMode(harness.settings.sessionMode)
      ? selectedTools.some((tool) => tool.function.name === "ask_user")
        ? selectedTools
        : [askUserTool(), ...selectedTools]
      : selectedTools;
  const personalPrompt =
    personalProfile && profileIsTrained(personalProfile) ? personalProfile.compiledPrompt : undefined;
  let system = buildSystemPrompt({
    harness,
    context,
    run,
    mcp,
    personalPrompt,
    personalAnswers: personalProfile?.answers,
  });
  const rebuildSystem = () => {
    system = buildSystemPrompt({
      harness,
      context,
      run,
      mcp,
      personalPrompt,
      personalAnswers: personalProfile?.answers,
    });
  };

  const toolContext = (opts?: { userAccepted?: boolean }) => ({
    runId: run.id,
    userId: user.$id,
    context,
    harness,
    mcp,
    databases,
    runs,
    workspaceId: run.workspaceId || mcpAuth.workspaceId,
    projectId: run.projectId || mcpAuth.projectId,
    mcpAuth,
    allowPersonalSave: training,
    plugins: harness.plugins,
    sourcePrompt: run.messages.find((message) => message.role === "user")?.content || run.prompt || "",
    latestUserText: lastUserText,
    userTexts,
    userAccepted: Boolean(opts?.userAccepted),
    permissionType: permissionType(),
    turnLimits,
  });

  const runTool = async (name: string, args: unknown, options?: { userAccepted?: boolean }) => {
    try {
      return await executeTool(name, args, toolContext({ userAccepted: options?.userAccepted }));
    } catch (error) {
      return failedToolResult(run.id, name, error);
    }
  };

  const refuseUnsolicitedDestructive = (
    call: AgentToolCall,
    messages: AgentChatMessage[],
    events?: AgentToolEvent[],
  ) => {
    events?.push({
      id: crypto.randomUUID(),
      type: "error",
      title: "Delete blocked",
      detail: DESTRUCTIVE_NOT_REQUESTED_MESSAGE,
      createdAt: new Date().toISOString(),
      runId: run.id,
    });
    messages.push({
      id: crypto.randomUUID(),
      role: "tool",
      content: JSON.stringify({
        error: DESTRUCTIVE_NOT_REQUESTED_MESSAGE,
        code: "DESTRUCTIVE_NOT_REQUESTED",
      }),
      toolCallId: call.id,
      toolName: call.name,
      createdAt: new Date().toISOString(),
    });
  };

  const queuedJobs = await claimQueuedJobs(databases, user.$id);
  for (const job of queuedJobs) {
    scheduleAgentJob({
      databases,
      userId: user.$id,
      jobId: job.id,
      context,
      plugins: harness.plugins,
      mcp,
      mcpAuth,
      harness,
      projectId: run.projectId || mcpAuth.projectId,
      workspaceId: run.workspaceId || mcpAuth.workspaceId,
    });
  }

  const seenCalls = fingerprintsFromMessages(run.messages);
  const listSlices = hydrateListSliceCache(run.messages);
  let failStreak = 0;
  let forceAnswer = false;
  let pluginGap: AgentCapability | null = null;
  let launchedCodingSessionFromPlan = false;

  const applyCallGate = (
    calls: AgentToolCall[],
    sinkMessages: AgentChatMessage[],
    sinkEvents?: AgentToolEvent[],
  ): AgentToolCall[] => {
    const recordBlocked = (
      blocked: AgentToolCall[],
      resultFor: (call: AgentToolCall) => string,
      thought?: { title: string; detail: string },
    ) => {
      for (const call of blocked) {
        const content = resultFor(call);
        seenCalls.set(toolCallFingerprint(call.name, call.arguments), content);
        sinkMessages.push({
          id: crypto.randomUUID(),
          role: "tool",
          content,
          toolCallId: call.id,
          toolName: call.name,
          createdAt: new Date().toISOString(),
        });
      }
      if (blocked.length && sinkEvents && thought) {
        sinkEvents.push(thoughtEvent(run.id, thought.title, thought.detail));
      }
      if (blocked.length && calls.length === blocked.length) forceAnswer = true;
    };
    if (conversationLooksLikeError(lastUserText) && !isNonRetryableAzureAuthError(lastUserText)) {
      const gated = filterCallsForErrorDump(calls);
      recordBlocked(gated.blocked, blockedErrorDumpResult, {
        title: "That message is an error",
        detail: "Fix the cited file. Do not treat the error as a spec to make a website or create work items.",
      });
      return gated.allowed;
    }
    if (
      isNonRetryableAzureAuthError(lastUserText) ||
      runHasNonRetryableSandboxAuth({
        events: [...(run.events ?? []), ...(sinkEvents ?? [])],
        messages: [...run.messages, ...sinkMessages],
      })
    ) {
      const gated = filterCallsForFailedSandboxAuth(calls);
      // #region agent log
      agentDebugLog({
        hypothesisId: "G",
        location: "runtime.ts:applyCallGate",
        message: "sandbox auth gate",
        data: {
          blockedStarts: gated.blocked.map((call) => call.name),
          userLooksLikeAuthError: isNonRetryableAzureAuthError(lastUserText),
          callNames: calls.map((call) => call.name),
        },
      });
      // #endregion
      recordBlocked(gated.blocked, blockedSandboxAuthResult, {
        title: "Azure sandbox auth failed",
        detail:
          "AADSTS700016: the app registration is not in this Entra tenant. Do not retry the coding session. GitHub Pages is not an Azure preview.",
      });
      return gated.allowed;
    }
    if (buildGateActive()) {
      const gated = filterCallsForBuildGate(calls);
      recordBlocked(gated.blocked, blockedBuildGateResult, {
        title: "Waiting for an accepted plan",
        detail:
          "Specialists, GitHub writes, PRs, and coding sessions stay blocked until you Accept the implementation plan.",
      });
      return gated.allowed;
    }
    if (sandboxWaitActive()) {
      const gated = filterCallsUntilSandbox(calls);
      recordBlocked(gated.blocked, blockedSandboxWaitResult, {
        title: "Waiting for sandbox preview",
        detail: "Wait for sandboxId and the preview URL before writing files or opening a PR.",
      });
      return gated.allowed;
    }
    return calls;
  };

  const applyToolCall = async (
    call: AgentToolCall,
    nextMessages: AgentChatMessage[],
    nextEvents: AgentToolEvent[],
    options?: { coalesced?: boolean; skipExecute?: boolean; userAccepted?: boolean },
  ): Promise<AgentToolCall[]> => {
    const canonical = canonicalizeToolCall(call);
    if (options?.skipExecute) {
      const listed = unwrapListCall(canonical);
      nextEvents.push(thoughtEvent(run.id, listed.tool === "web_fetch" ? "Skipped extra page fetch" : "Skipped extra work-item get"));
      nextMessages.push({
        id: crypto.randomUUID(),
        role: "tool",
        content: listed.tool === "web_fetch" || canonical.name === "web_fetch" ? SKIPPED_WEB_FETCH : SKIPPED_WORK_ITEM_GET,
        toolCallId: canonical.id,
        toolName: canonical.name,
        createdAt: new Date().toISOString(),
      });
      return [];
    }
    const fingerprint = toolCallFingerprint(canonical.name, canonical.arguments);
    const previous = seenCalls.get(fingerprint);
    if (previous !== undefined) {
      nextEvents.push(thoughtEvent(run.id, options?.coalesced ? "Combined overlapping lists" : "Reused previous result"));
      nextMessages.push({
        id: crypto.randomUUID(),
        role: "tool",
        content: options?.coalesced
          ? coalescedListMessage(previous, canonical.name)
          : repeatedToolMessage(previous, canonical.name),
        toolCallId: canonical.id,
        toolName: canonical.name,
        createdAt: new Date().toISOString(),
      });
      return [];
    }

    const listed = unwrapListCall(canonical);
    const slice = resolveListSliceCall(listSlices, listed.tool, listed.args);
    if (slice.action === "skip") {
      seenCalls.set(fingerprint, slice.content);
      nextEvents.push(thoughtEvent(run.id, "Skipped extra list page"));
      nextMessages.push({
        id: crypto.randomUUID(),
        role: "tool",
        content: slice.content,
        toolCallId: call.id,
        toolName: call.name,
        createdAt: new Date().toISOString(),
      });
      return [];
    }

    const result = await runTool(canonical.name, canonical.arguments, { userAccepted: options?.userAccepted });
    if (result.harnessPatch) {
      harness = await upsertHarness(databases, user.$id, result.harnessPatch);
    }
    if (result.missingCapability) pluginGap = result.missingCapability;
    nextEvents.push(result.event);
    let toolContent = compactJsonString(result.content, 4000);
    let pendingWrites: AgentToolCall[] = [];
    if (result.delegate) {
      const specialist = await runSpecialistPass(
        specialistById(result.delegate.agent),
        result.delegate.task,
        "orchestrator",
        result.delegate.subject,
      );
      nextEvents.push(...specialist.events);
      pendingWrites = specialist.pendingWrites;
      toolContent = compactJsonString(
        JSON.stringify({
          agent: result.delegate.agent,
          task: result.delegate.task,
          result: specialist.content,
          pendingWrites: pendingWrites.map((item) => item.name),
        }),
        8000,
      );
    }
    seenCalls.set(fingerprint, toolContent);
    rememberListSlice(listSlices, listed.tool, listed.args, toolContent);
    if (!isFailedToolContent(toolContent)) {
      forgetListCachesAfterMutation(seenCalls, listSlices, listed.tool || canonical.name);
    }
    failStreak = isFailedToolContent(toolContent) ? failStreak + 1 : 0;
    nextMessages.push({
      id: crypto.randomUUID(),
      role: "tool",
      content: toolContent,
      toolCallId: call.id,
      toolName: call.name,
      createdAt: new Date().toISOString(),
    });
    if (
      (canonical.name === "github_create_repo" || canonical.name === "github_link_repo") &&
      run.projectId &&
      !isFailedToolContent(result.content)
    ) {
      try {
        const parsed = JSON.parse(result.content) as {
          linked?: boolean;
          owner?: string;
          repo?: string;
          githubUrl?: string;
          htmlUrl?: string;
          defaultBranch?: string;
          branch?: string;
        };
        if (parsed.linked && parsed.owner && parsed.repo) {
          context = mergeProjectGithubRepo(context, {
            projectId: run.projectId,
            workspaceId: run.workspaceId || "",
            owner: parsed.owner,
            repo: parsed.repo,
            githubUrl: parsed.githubUrl || parsed.htmlUrl,
            branch: parsed.branch || parsed.defaultBranch,
          });
          rebuildSystem();
        }
      } catch {
        /* keep prior context */
      }
    }
    if (!isFailedToolContent(result.content)) {
      if (canonical.name === "submit_implementation_plan") {
        let parsedPlan: unknown = null;
        try {
          parsedPlan = JSON.parse(result.content);
        } catch {
          parsedPlan = null;
        }
        const plan = parseImplementationPlan(parsedPlan);
        if (plan) {
          run.implementationPlan = { ...plan, status: "accepted" };
          rebuildSystem();
        }
      }
      if (canonical.name === "coding_session_start") {
        launchedCodingSessionFromPlan = true;
        try {
          const parsed = JSON.parse(result.content) as { sessionId?: string };
          if (parsed.sessionId) run.sessionId = parsed.sessionId;
        } catch {
          /* ignore */
        }
      }
      if (run.implementationPlan && planIsAccepted(run.implementationPlan)) {
        run.implementationPlan = applyPlanProgressFromTool(run.implementationPlan, canonical.name);
      }
    }
    const launch = extractBoardProjectFromTool(canonical.name, toolContent, canonical.arguments);
    if (launch?.projectId) {
      const workspaceId = launch.workspaceId || run.workspaceId || "";
      if (run.projectId !== launch.projectId || (workspaceId && run.workspaceId !== workspaceId)) {
        run = await persistUnlessStopped({
          projectId: launch.projectId,
          ...(workspaceId ? { workspaceId } : {}),
        });
        if (run.status === "stopped") return [];
        harness = await upsertHarness(databases, user.$id, {
          settings: {
            defaultProjectId: launch.projectId,
            ...(workspaceId ? { defaultWorkspaceId: workspaceId } : {}),
          },
        });
      }
    }
    if (
      canonical.name === "submit_implementation_plan" &&
      planIsAccepted(run.implementationPlan) &&
      !launchedCodingSessionFromPlan &&
      hasProjectGithubRepo(context, run.projectId)
    ) {
      const args = run.implementationPlan
        ? codingSessionArgsFromPlan(
            run.implementationPlan,
            context.workItems.find((item) => item.projectId === run.projectId)?.id ||
              context.workItems[0]?.id,
          )
        : null;
      if (args) {
        const startCall: AgentToolCall = {
          id: crypto.randomUUID(),
          name: "coding_session_start",
          arguments: JSON.stringify({ workItemId: args.workItemId, exposePort: args.exposePort }),
        };
        nextMessages.push({
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          toolCalls: [startCall],
          createdAt: new Date().toISOString(),
        });
        await applyToolCall(startCall, nextMessages, nextEvents, { userAccepted: true });
      }
    }
    return pendingWrites;
  };

  const pauseForConfirmation = async (
    nextMessages: AgentChatMessage[],
    nextEvents: AgentToolEvent[],
    writes: AgentToolCall[],
  ) => {
    const planCall = writes.find((call) => call.name === "submit_implementation_plan");
    if (planCall && !planIsAccepted(run.implementationPlan)) {
      try {
        const draft = parseImplementationPlan(JSON.parse(planCall.arguments || "{}"));
        if (draft) {
          run.implementationPlan = { ...draft, status: "draft" };
          rebuildSystem();
        }
      } catch {
        /* keep prior plan */
      }
    }
    const summary = writes.map((call) => confirmationSummary(call)).join(" · ");
    nextEvents.push({
      id: crypto.randomUUID(),
      type: "confirmation",
      title: summary,
      payload: { calls: writes, summary },
      createdAt: new Date().toISOString(),
      runId: run.id,
    });
    return persistUnlessStopped({
      messages: nextMessages,
      events: nextEvents,
      status: "awaiting_confirmation",
      error: "",
    });
  };

  const pauseForQuestion = async (
    nextMessages: AgentChatMessage[],
    nextEvents: AgentToolEvent[],
    call: AgentToolCall,
  ) => {
    const asked = parseAskUserArgs(call.arguments);
    nextEvents.push({
      id: crypto.randomUUID(),
      type: "ask_user",
      title: asked.question || "Waiting for your answer",
      payload: {
        question: asked.question,
        options: asked.options,
        allowCustom: asked.allowCustom,
        toolCallId: call.id,
      },
      createdAt: new Date().toISOString(),
      runId: run.id,
    });
    return persistUnlessStopped({
      messages: nextMessages,
      events: nextEvents,
      status: "awaiting_question",
      error: "",
    });
  };

  const pauseForPlugin = async (
    capability: AgentCapability,
    nextMessages: AgentChatMessage[],
    nextEvents: AgentToolEvent[],
  ) => {
    const catalog = catalogForCapability(capability);
    const summary =
      capability === "email.send"
        ? "Connect Outlook, Gmail, Resend, or a mail MCP server to send email."
        : capability === "code.write" || capability === "code.read"
          ? "Connect your GitHub account to your Fairlx profile. Sign in with GitHub or paste a PAT with repo and read:org."
          : `Connect a plugin for ${capability}.`;
    nextEvents.push({
      id: crypto.randomUUID(),
      type: "plugin_required",
      title: summary,
      payload: { capability, catalogIds: catalog.map((item) => item.id), summary },
      createdAt: new Date().toISOString(),
      runId: run.id,
    });
    return persistUnlessStopped({
      messages: nextMessages,
      events: nextEvents,
      status: "awaiting_plugin",
      error: "",
    });
  };

  const runSpecialistPass = async (
    specialist: AgentSpecialistId,
    task: string,
    parent: string,
    subject?: string,
  ): Promise<{ content: string; events: AgentToolEvent[]; pendingWrites: AgentToolCall[]; subagentId: string }> => {
    const subagentId = crypto.randomUUID();
    const parentPrompt = parentPromptFromMessages(run.messages, run.prompt);
    const specialistTask = buildSpecialistUserMessage({ task, parentPrompt, subject });
      const specialistTarget = specialistChatTarget(
        specialist,
        { worker: workerTarget, builder: builderTarget, reviewer: reviewerTarget },
        planAccepted(),
      );
      const events: AgentToolEvent[] = [
        {
          id: crypto.randomUUID(),
          type: "subagent_started",
          title: `${specialist} started${subject ? ` · ${subject}` : ""}`,
          detail: (subject ? `${subject}: ${task}` : task).slice(0, 180),
          payload: {
            id: subagentId,
            specialist,
            parent,
            task,
            subject,
            modelName: specialistTarget.displayName,
            modelId: specialistTarget.modelId,
          },
          createdAt: new Date().toISOString(),
          runId: run.id,
        },
      ];
    const pendingWrites: AgentToolCall[] = [];
    const specialistRun: AgentRun = {
      ...run,
      prompt: specialistTask,
      messages: [
        {
          id: crypto.randomUUID(),
          role: "user",
          content: specialistTask,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    let messages = specialistRun.messages;
    const isolatedTools = filterToolsForSpecialist(tools, specialist);
    const specialistSystem = buildSystemPrompt({ harness, context, run: specialistRun, mcp, specialist });
    for (let iteration = 0; iteration < MAX_SPECIALIST_ITERATIONS; iteration += 1) {
      if (cancelledRuns.has(run.id)) break;
      events.push({
        id: crypto.randomUUID(),
        type: "subagent_progress",
        title: `${specialist} thinking`,
        payload: { id: subagentId, specialist, parent, iteration },
        createdAt: new Date().toISOString(),
        runId: run.id,
      });
      await persistMergedEvents(events);
      const completion = await chatCompletion(
        specialistTarget,
        {
          model: specialistTarget.model,
          messages: toOpenAiMessages(specialistSystem, messages, {
            maxInputTokens: specialistTarget.maxInputTokens,
          }),
          temperature: 0.2,
          ...(specialistTarget.maxOutputTokens ? { max_tokens: specialistTarget.maxOutputTokens } : {}),
          ...(isolatedTools.length ? { tools: isolatedTools, tool_choice: "auto" } : {}),
        },
        run.id,
      );
      const usageEvent = await captureUsage(
        completion,
        specialistTarget,
        `${run.id}:sub:${subagentId}:${iteration}`,
        { role: "subagent", specialist, subagentId, iteration },
      );
      if (usageEvent) events.push(attachSubagent(usageEvent, subagentId, specialist));
      await persistMergedEvents(events);
      const collected = collectToolCalls(completion?.choices?.[0], mcpToolNames);
      if (!collected.toolCalls.length) {
        events.push({
          id: crypto.randomUUID(),
          type: "subagent_done",
          title: `${specialist} finished`,
          payload: { id: subagentId, specialist, parent, task },
          createdAt: new Date().toISOString(),
          runId: run.id,
        });
        await persistMergedEvents(events);
        return {
          content: capSpecialistResult(
            sanitizeAssistantVisible(collected.content) || "Specialist finished with no additional notes.",
          ),
          events,
          pendingWrites,
          subagentId,
        };
      }
      messages = [
        ...messages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: collected.content || "",
          toolCalls: collected.toolCalls,
          createdAt: new Date().toISOString(),
        },
      ];
      const executable: AgentToolCall[] = [];
      for (const call of collected.toolCalls) {
        if (call.name === "delegate_agent") continue;
        if (isDestructiveToolCall(call) && !conversationAllowsDelete) {
          refuseUnsolicitedDestructive(call, messages, events);
          continue;
        }
        if (
          needsConfirmation(call, permissionType(), { autonomousCoding: autonomousCoding() }) &&
          !(planAccepted() && call.name === "coding_session_start")
        ) {
          pendingWrites.push(call);
          messages.push({
            id: crypto.randomUUID(),
            role: "tool",
            content: JSON.stringify({ queued: true, awaitingAccept: true, name: call.name }),
            toolCallId: call.id,
            toolName: call.name,
            createdAt: new Date().toISOString(),
          });
          continue;
        }
        executable.push(call);
      }
      const gatedExecutable = applyCallGate(executable, messages, events);
      executable.length = 0;
      executable.push(...gatedExecutable);
      const applySpecialistResult = async (
        call: AgentToolCall,
        result: Awaited<ReturnType<typeof executeTool>>,
      ) => {
        if (result.harnessPatch) {
          harness = await upsertHarness(databases, user.$id, result.harnessPatch);
        }
        if (result.missingCapability) pluginGap = result.missingCapability;
        events.push(attachSubagent(result.event, subagentId, specialist));
        messages.push({
          id: crypto.randomUUID(),
          role: "tool",
          content: compactJsonString(result.content, 4000),
          toolCallId: call.id,
          toolName: call.name,
          createdAt: new Date().toISOString(),
        });
      };
      const { calls: specialistCalls, coalescedIds: specialistCoalesced } = collapseWorkItemListFanOut(executable);
      const { skipIds: specialistSkip } = collapseRedundantReadFanOut(specialistCalls);
      for (const group of groupParallelizable(specialistCalls, (call) => !isWriteToolCall(call))) {
        if (group.parallel && group.items.length > 1) {
          const settled = await Promise.all(
            group.items.map(async (call) => {
              if (specialistSkip.has(call.id) || specialistCoalesced.has(call.id)) {
                const listed = unwrapListCall(call);
                const skippedFetch = listed.tool === "web_fetch" || call.name === "web_fetch";
                return {
                  call,
                  skip: true as const,
                  content: skippedFetch ? SKIPPED_WEB_FETCH : SKIPPED_WORK_ITEM_GET,
                  title: skippedFetch ? "Skipped extra page fetch" : "Skipped extra work-item get",
                };
              }
              return {
                call,
                skip: false as const,
                result: await runTool(call.name, call.arguments),
              };
            }),
          );
          for (const item of settled) {
            if (item.skip) {
              events.push(attachSubagent(thoughtEvent(run.id, item.title), subagentId, specialist));
              messages.push({
                id: crypto.randomUUID(),
                role: "tool",
                content: item.content,
                toolCallId: item.call.id,
                toolName: item.call.name,
                createdAt: new Date().toISOString(),
              });
              continue;
            }
            await applySpecialistResult(item.call, item.result);
          }
          await persistMergedEvents(events);
        } else {
          for (const call of group.items) {
            if (specialistSkip.has(call.id) || specialistCoalesced.has(call.id)) {
              const listed = unwrapListCall(call);
              const skippedFetch = listed.tool === "web_fetch" || call.name === "web_fetch";
              events.push(
                attachSubagent(
                  thoughtEvent(run.id, skippedFetch ? "Skipped extra page fetch" : "Skipped extra work-item get"),
                  subagentId,
                  specialist,
                ),
              );
              messages.push({
                id: crypto.randomUUID(),
                role: "tool",
                content: skippedFetch ? SKIPPED_WEB_FETCH : SKIPPED_WORK_ITEM_GET,
                toolCallId: call.id,
                toolName: call.name,
                createdAt: new Date().toISOString(),
              });
              continue;
            }
            const result = await runTool(call.name, call.arguments);
            await applySpecialistResult(call, result);
            await persistMergedEvents(events);
          }
        }
      }
      if (pendingWrites.length) {
        events.push({
          id: crypto.randomUUID(),
          type: "subagent_done",
          title: `${specialist} waiting for approval`,
          payload: { id: subagentId, specialist, parent, task },
          createdAt: new Date().toISOString(),
          runId: run.id,
        });
        await persistMergedEvents(events);
        return {
          content: capSpecialistResult("Proposed high-risk writes are waiting for Accept."),
          events,
          pendingWrites,
          subagentId,
        };
      }
    }
    const last = [...messages].reverse().find((message) => message.role === "assistant" && message.content);
    events.push({
      id: crypto.randomUUID(),
      type: "subagent_done",
      title: `${specialist} reached its tool limit`,
      payload: { id: subagentId, specialist, parent, task },
      createdAt: new Date().toISOString(),
      runId: run.id,
    });
    await persistMergedEvents(events);
    return { content: capSpecialistResult(last?.content || "Specialist reached its tool limit."), events, pendingWrites, subagentId };
  };

  try {
    if (!resume && !training && !unmatchedToolCalls(run).some((call) => call.name === "ask_user")) {
      const missing = missingCapabilities(lastUserText, harness.plugins, context);
      if (missing[0]) {
        return pauseForPlugin(missing[0], run.messages, run.events);
      }
      const ownerChoice = pendingGithubOwnerChoice(run.messages);
      const chosenOwner = ownerChoice ? matchGithubOwnerReply(lastUserText, ownerChoice.owners) : undefined;
      if (chosenOwner && conversationWantsGithubCreateRepo(attachHaystack)) {
        const project = context.projects.find((item) => item.id === run.projectId);
        const createCall: AgentToolCall = {
          id: crypto.randomUUID(),
          name: "github_create_repo",
          arguments: JSON.stringify(
            githubCreateRepoArgsFromOwnerChoice({
              owner: chosenOwner,
              projectName: project?.name,
              projectKey: project?.key,
              private: conversationWantsGithubVisibility(attachHaystack) !== "public",
            }),
          ),
        };
        const nextMessages: AgentChatMessage[] = [
          ...run.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "",
            toolCalls: [createCall],
            createdAt: new Date().toISOString(),
          },
        ];
        return pauseForConfirmation(nextMessages, run.events, [createCall]);
      }
      const visibility = conversationWantsGithubVisibility(lastUserText);
      if (visibility && hasGithubAccount(context)) {
        const attached = projectGithubRepos(context, run.projectId)[0];
        const fromMessages = latestGithubRepoRef(run.messages);
        const owner = attached?.owner || fromMessages?.owner;
        const repo = attached?.repositoryName || fromMessages?.repo;
        if (owner && repo) {
          const updateCall: AgentToolCall = {
            id: crypto.randomUUID(),
            name: "github_update_repo",
            arguments: JSON.stringify({
              owner,
              repo,
              private: visibility === "private",
              visibility,
            }),
          };
          const nextMessages: AgentChatMessage[] = [
            ...run.messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "",
              toolCalls: [updateCall],
              createdAt: new Date().toISOString(),
            },
          ];
          return pauseForConfirmation(nextMessages, run.events, [updateCall]);
        }
      }
    }

    if (resume) {
      const pending = findPendingConfirmation(run.events, run.messages) ?? { calls: unmatchedToolCalls(run), summary: "" };
      const pendingCalls = pending.calls.length ? pending.calls : unmatchedToolCalls(run);
      const nextMessages = [...run.messages];
      const nextEvents = [
        ...run.events,
        {
          id: crypto.randomUUID(),
          type: "confirmation_resolved" as const,
          title: resume.decision === "accept" ? "Accepted" : "Denied",
          createdAt: new Date().toISOString(),
          runId: run.id,
        },
      ];
      snapshotMessages = nextMessages;
      snapshotEvents = nextEvents;
      // Persist resolved immediately so the UI drops Accept/Deny even if the
      // following tool/model work takes a while or another poller is stale.
      run = await persistUnlessStopped({
        events: nextEvents,
        status: "running",
        error: "",
      });
      if (run.status === "stopped") return run;
      if (resume.decision === "deny") {
        if (pendingCalls.some((call) => call.name === "submit_implementation_plan") && run.implementationPlan) {
          run.implementationPlan = { ...run.implementationPlan, status: "rejected" };
        }
        for (const call of pendingCalls) {
          nextMessages.push({
            id: crypto.randomUUID(),
            role: "tool",
            content: JSON.stringify({ error: "The user denied this action." }),
            toolCallId: call.id,
            toolName: call.name,
            createdAt: new Date().toISOString(),
          });
        }
      } else {
        for (const call of pendingCalls) {
          const stoppedBeforeTool = await haltIfStopped();
          if (stoppedBeforeTool) return stoppedBeforeTool;
          await applyToolCall(call, nextMessages, nextEvents, { userAccepted: true });
        }
      }
      run = await persistUnlessStopped({
        messages: nextMessages,
        events: nextEvents,
        status: "running",
        error: "",
      });
      if (run.status === "stopped") return run;
    }

    if (!resume) {
      const unmatchedAsk = unmatchedToolCalls(run).find((call) => call.name === "ask_user");
      if (unmatchedAsk) {
        const last = run.messages[run.messages.length - 1];
        if (last?.role === "user") {
          const nextMessages = [
            ...run.messages,
            {
              id: crypto.randomUUID(),
              role: "tool" as const,
              content: JSON.stringify({ answer: displayUserContent(last.content), source: "user" }),
              toolCallId: unmatchedAsk.id,
              toolName: "ask_user",
              createdAt: new Date().toISOString(),
            },
          ];
          run = await persistUnlessStopped({
            messages: nextMessages,
            status: "running",
            error: "",
          });
          if (run.status === "stopped") return run;
        } else {
          return pauseForQuestion(run.messages, run.events, unmatchedAsk);
        }
      }
    }

    if (!resume && run.mode === "agent" && !training) {
      const lastUser = [...run.messages].reverse().find((message) => message.role === "user");
      const intent = compileFairlxListIntent(displayUserContent(lastUser?.content || run.prompt || ""), {
        projectId: run.projectId || mcpAuth.projectId,
      });
      if (intent) {
        const call: AgentToolCall = {
          id: crypto.randomUUID(),
          name: intent.tool,
          arguments: JSON.stringify(intent.args),
        };
        if (!seenCalls.has(toolCallFingerprint(call.name, call.arguments))) {
          const nextMessages: AgentChatMessage[] = [
            ...run.messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "",
              toolCalls: [call],
              createdAt: new Date().toISOString(),
            },
          ];
          const nextEvents = [...run.events];
          await applyToolCall(call, nextMessages, nextEvents);
          run = await persistUnlessStopped({
            messages: nextMessages,
            events: nextEvents,
            status: "running",
          });
          if (run.status === "stopped") return run;
        }
      }
    }

    const maxIterations = training ? 2 : MAX_TOOL_ITERATIONS;
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const stopped = await haltIfStopped();
      if (stopped) return stopped;

      const fittedTokens = estimatedFittedTokens(system, run.messages, target.maxInputTokens);
      const researched = hasRequiredWebResearch(turnLimits);
      const tight = Boolean(
        target.maxInputTokens &&
          target.maxInputTokens > 0 &&
          fittedTokens >= target.maxInputTokens * CONTEXT_BUDGET_RATIO,
      );
      if (tight) {
        const compacted = fitMessagesForModel(system, run.messages, target.maxInputTokens);
        const beforeChars = run.messages.reduce((sum, message) => sum + (message.content?.length ?? 0), 0);
        const afterChars = compacted.reduce((sum, message) => sum + (message.content?.length ?? 0), 0);
        if (afterChars < beforeChars) {
          run = await persistUnlessStopped({
            messages: compacted,
            events: appendEvents([...snapshotEvents], [
              thoughtEvent(
                run.id,
                "Re-optimizing context",
                "Compacted older tool results to stay inside the model window.",
              ),
            ]),
            status: "running",
          });
          if (run.status === "stopped") return run;
        }
      }
      const iterationTools =
        !training && tight && tools.length && !forceAnswer
          ? toolsWhenContextIsTight(tools, researched)
          : tools;
      const writeNow = !training && tight && researched;

      if (iteration === 0) {
        run = await persistUnlessStopped({
          events: withContextMeter({
            events: run.events,
            runId: run.id,
            system,
            tools: iterationTools,
            messages: run.messages,
            harness,
            mcp,
            maxInputTokens: target.maxInputTokens ?? 0,
          }),
        });
        if (run.status === "stopped") return run;
      }

      run = await persistUnlessStopped({
        events: appendEvents([...snapshotEvents], [
          thoughtEvent(
            run.id,
            writeNow
              ? "Context is filling — writing from research already gathered"
              : iteration === 0
                ? "Thinking"
                : "Planning next steps",
            `Pass ${iteration + 1}`,
          ),
        ]),
        status: "running",
      });
      if (run.status === "stopped") return run;

      const completeOnce = (budgetRatio?: number) =>
        chatCompletion(
          target,
          {
            model: target.model,
            messages: toOpenAiMessages(system, run.messages, {
              seedTraining: training,
              maxInputTokens: target.maxInputTokens,
              budgetRatio,
            }),
            temperature: 0.2,
            ...(target.maxOutputTokens ? { max_tokens: target.maxOutputTokens } : {}),
            ...(iterationTools.length && !forceAnswer ? { tools: iterationTools, tool_choice: "auto" } : {}),
          },
          run.id,
        );

      let completion: Awaited<ReturnType<typeof chatCompletion>>;
      try {
        completion = await completeOnce();
      } catch (error) {
        if (!isContextLengthError(error) || cancelledRuns.has(run.id)) throw error;
        run = await persistUnlessStopped({
          events: appendEvents([...snapshotEvents], [
            thoughtEvent(run.id, "Shrinking context and retrying", `Pass ${iteration + 1}`),
          ]),
          status: "running",
        });
        if (run.status === "stopped") return run;
        completion = await chatCompletion(
          target,
          {
            model: target.model,
            messages: toOpenAiMessages(system, run.messages, {
              seedTraining: training,
              maxInputTokens: target.maxInputTokens,
              budgetRatio: 0.5,
            }),
            temperature: 0.2,
            ...(target.maxOutputTokens ? { max_tokens: target.maxOutputTokens } : {}),
            ...(iterationTools.length && !forceAnswer
              ? {
                  tools: researched ? toolsWhenContextIsTight(tools, true) : iterationTools,
                  tool_choice: "auto",
                }
              : {}),
          },
          run.id,
        );
      }
      const usageEvent = await captureUsage(completion, target, `${run.id}:main:${iteration}`, {
        role: "orchestrator",
        iteration,
      });
      if (usageEvent) {
        run = await persistUnlessStopped({
          events: appendEvents([...snapshotEvents], [usageEvent]),
          status: "running",
        });
        if (run.status === "stopped") return run;
      }
      const stoppedAfterChat = await haltIfStopped();
      if (stoppedAfterChat) return stoppedAfterChat;

      const reasoning = extractReasoning(completion?.choices?.[0]?.message);
      if (reasoning) {
        run = await persistUnlessStopped({
          events: appendEvents([...snapshotEvents], [thoughtEvent(run.id, "Reasoning", reasoning.slice(0, 4000))]),
          status: "running",
        });
        if (run.status === "stopped") return run;
      }

      const collected = collectToolCalls(completion?.choices?.[0], mcpToolNames, {
        fromText: !training,
      });
      const content = sanitizeAssistantVisible(collected.content);
      const toolCalls = training
        ? collected.toolCalls.filter((call) => call.name === "save_personal_agent" || call.name === "ask_user")
        : collected.toolCalls;

      if (toolCalls.length && !forceAnswer) {
        const assistantMessage: AgentChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content,
          toolCalls,
          createdAt: new Date().toISOString(),
        };
        const nextMessages = [...run.messages, assistantMessage];
        const refusedDestructive: AgentToolCall[] = [];
        const allowedCalls: AgentToolCall[] = [];
        for (const call of toolCalls) {
          if (isDestructiveToolCall(call) && !conversationAllowsDelete) {
            refusedDestructive.push(call);
            refuseUnsolicitedDestructive(call, nextMessages);
          } else {
            allowedCalls.push(call);
          }
        }
        const saveCall = allowedCalls.find((call) => call.name === "save_personal_agent");
        const askCall = allowedCalls.find((call) => call.name === "ask_user");
        if (askCall && !saveCall) {
          assistantMessage.toolCalls = [askCall];
          const askedEvents = withContextMeter({
            events: run.events,
            runId: run.id,
            system,
            tools: iterationTools,
            messages: nextMessages,
            harness,
            mcp,
            maxInputTokens: target.maxInputTokens ?? 0,
          });
          return pauseForQuestion(nextMessages, askedEvents, askCall);
        }
        const nextEvents = withContextMeter({
          events: run.events,
          runId: run.id,
          system,
          tools: iterationTools,
          messages: nextMessages,
          harness,
          mcp,
          maxInputTokens: target.maxInputTokens ?? 0,
        });
        const confirmNeeded = (call: AgentToolCall) => {
          if (planAccepted() && call.name === "coding_session_start") return false;
          return needsConfirmation(call, permissionType(), { autonomousCoding: autonomousCoding() });
        };
        const workingCalls = applyCallGate(allowedCalls, nextMessages, nextEvents);
        const gated = workingCalls.filter((call) => confirmNeeded(call));
        const autoCalls = workingCalls.filter((call) => !confirmNeeded(call));
        const rest = autoCalls.filter((call) => call.name !== "delegate_agent");
        const attached = run.messages.flatMap((message) =>
          message.role === "user" ? extractAttachedFiles(message.content) : [],
        );
        const fanned = fanOutDelegatesForSubjects(
          autoCalls.filter((call) => call.name === "delegate_agent"),
          subjectsFromFiles(attached),
        );
        const delegates = fanned.calls;
        if (fanned.expanded) {
          assistantMessage.toolCalls = [
            ...toolCalls.filter((call) => call.name !== "delegate_agent"),
            ...delegates,
          ];
        }
        if (refusedDestructive.length) {
          nextEvents.push({
            id: crypto.randomUUID(),
            type: "error",
            title: refusedDestructive.length === 1 ? "Delete blocked" : `${refusedDestructive.length} deletes blocked`,
            detail: DESTRUCTIVE_NOT_REQUESTED_MESSAGE,
            createdAt: new Date().toISOString(),
            runId: run.id,
          });
        }
        snapshotMessages = nextMessages;
        snapshotEvents = nextEvents;
        const { calls: restCalls, coalescedIds } = collapseWorkItemListFanOut(rest);
        const { skipIds } = collapseRedundantReadFanOut(restCalls);
        const specialistWrites: AgentToolCall[] = [];

        for (const group of groupParallelizable(restCalls, (call) => !isWriteToolCall(call))) {
          const stoppedBeforeTool = await haltIfStopped();
          if (stoppedBeforeTool) return stoppedBeforeTool;
          if (group.parallel && group.items.length > 1) {
            const settled = await Promise.all(
              group.items.map(async (call) => {
                const localMessages: AgentChatMessage[] = [];
                const localEvents: AgentToolEvent[] = [];
                const extra = await applyToolCall(call, localMessages, localEvents, {
                  coalesced: coalescedIds.has(call.id),
                  skipExecute: skipIds.has(call.id),
                });
                return { localMessages, localEvents, extra };
              }),
            );
            for (const item of settled) {
              nextMessages.push(...item.localMessages);
              nextEvents.push(...item.localEvents);
              specialistWrites.push(...item.extra);
            }
          } else {
            for (const call of group.items) {
              const extra = await applyToolCall(call, nextMessages, nextEvents, {
                coalesced: coalescedIds.has(call.id),
                skipExecute: skipIds.has(call.id),
              });
              specialistWrites.push(...extra);
            }
          }
          run = await persistUnlessStopped({
            messages: nextMessages,
            events: nextEvents,
            status: "running",
          });
          if (run.status === "stopped") return run;
        }

        if (delegates.length) {
          nextEvents.push(
            thoughtEvent(
              run.id,
              delegates.length === 1
                ? "Running 1 subagent"
                : `Running ${delegates.length} subagents in parallel`,
              fanned.expanded ? `Split into ${delegates.length} subject specialists.` : undefined,
            ),
          );
          await persistUnlessStopped({
            messages: nextMessages,
            events: nextEvents,
            status: "running",
          });
          for (const batch of chunkForParallel(delegates, MAX_PARALLEL_SUBAGENTS)) {
            const stoppedBeforeBatch = await haltIfStopped();
            if (stoppedBeforeBatch) return stoppedBeforeBatch;
            const settled = await Promise.all(
              batch.map(async (call) => {
                const result = await runTool(call.name, call.arguments);
                if (result.event) await persistMergedEvents([result.event]);
                if (!result.delegate) {
                  return { call, result, specialist: undefined as Awaited<ReturnType<typeof runSpecialistPass>> | undefined };
                }
                const specialist = await runSpecialistPass(
                  specialistById(result.delegate.agent),
                  result.delegate.task,
                  "orchestrator",
                  result.delegate.subject,
                );
                return { call, result, specialist };
              }),
            );
            appendEvents(nextEvents, snapshotEvents);
            for (const item of settled) {
              appendEvents(nextEvents, [item.result.event]);
              const pendingWrites = item.specialist?.pendingWrites ?? [];
              specialistWrites.push(...pendingWrites);
              if (item.specialist) appendEvents(nextEvents, item.specialist.events);
              if (item.result.missingCapability) pluginGap = item.result.missingCapability;
              nextMessages.push({
                id: crypto.randomUUID(),
                role: "tool",
                content: item.specialist
                  ? compactJsonString(
                      JSON.stringify({
                        agent: item.result.delegate?.agent,
                        task: item.result.delegate?.task,
                        result: item.specialist.content,
                        pendingWrites: pendingWrites.map((write) => write.name),
                      }),
                      8000,
                    )
                  : compactJsonString(item.result.content, 8000),
                toolCallId: item.call.id,
                toolName: item.call.name,
                createdAt: new Date().toISOString(),
              });
            }
            snapshotEvents = nextEvents;
            run = await persistUnlessStopped({
              messages: nextMessages,
              events: nextEvents,
              status: "running",
            });
            if (run.status === "stopped") return run;
          }
        }

        if (pluginGap && isGithubCapability(pluginGap) && hasGithubAccount(context)) {
          pluginGap = null;
        }
        if (pluginGap) {
          return pauseForPlugin(pluginGap, nextMessages, nextEvents);
        }

        const writesToConfirm = [
          ...gated,
          ...specialistWrites.filter((call) => {
            if (isDestructiveToolCall(call) && !conversationAllowsDelete) {
              refuseUnsolicitedDestructive(call, nextMessages, nextEvents);
              return false;
            }
            return confirmNeeded(call);
          }),
        ];
        const autoSpecialistWrites = specialistWrites.filter((call) => {
          if (isDestructiveToolCall(call) && !conversationAllowsDelete) return false;
          return !confirmNeeded(call);
        });
        for (const call of autoSpecialistWrites) {
          const stoppedBeforeTool = await haltIfStopped();
          if (stoppedBeforeTool) return stoppedBeforeTool;
          await applyToolCall(call, nextMessages, nextEvents);
          run = await persistUnlessStopped({
            messages: nextMessages,
            events: nextEvents,
            status: "running",
          });
          if (run.status === "stopped") return run;
        }

        if (writesToConfirm.length) {
          if (gated.length === 0 && specialistWrites.length) {
            nextMessages.push({
              id: crypto.randomUUID(),
              role: "assistant",
              content: "",
              toolCalls: writesToConfirm,
              createdAt: new Date().toISOString(),
            });
          }
          return pauseForConfirmation(nextMessages, nextEvents, writesToConfirm);
        }

        run = await persistUnlessStopped({
          messages: nextMessages,
          events: nextEvents,
          status: "running",
        });
        if (run.status === "stopped") return run;
        if (training) {
          forceAnswer = true;
        } else if (shouldForceAnswer(failStreak)) {
          forceAnswer = true;
        }
        continue;
      }

      const assistantMessage: AgentChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          content ||
          (forceAnswer
            ? "I could not complete the lookup. Please retry or rephrase the request."
            : "Done."),
        createdAt: new Date().toISOString(),
      };
      const hasAuthFailure =
        isNonRetryableAzureAuthError(lastUserText) ||
        runHasNonRetryableSandboxAuth({
          events: snapshotEvents,
          messages: run.messages,
        });
      const rewritten = rewriteSandboxAuthAssistantContent({
        userText: lastUserText,
        assistantText: assistantMessage.content,
        hasAuthFailure,
      });
      // #region agent log
      agentDebugLog({
        hypothesisId: "J",
        location: "runtime.ts:finalAnswer",
        message: "sandbox auth answer rewrite",
        data: {
          hasAuthFailure,
          rewritten: rewritten !== assistantMessage.content,
          wantsAzure: /\bazure sandbox\b/i.test(lastUserText),
        },
      });
      // #endregion
      assistantMessage.content = rewritten;
      const completedMessages = [...run.messages, assistantMessage];
      const facts = factsFromTurn(completedMessages);
      if (facts.length) {
        harness = await upsertHarness(databases, user.$id, {
          knowledge: mergeStateKnowledge(harness.knowledge, facts),
        });
      }
      return persistUnlessStopped({
        messages: completedMessages,
        events: snapshotEvents,
        status: "completed",
        error: "",
      });
    }

    const limitMessage: AgentChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "I reached the tool-call limit for this turn. Ask me to continue if you want another pass.",
      createdAt: new Date().toISOString(),
    };
    return persistUnlessStopped({
      messages: [...run.messages, limitMessage],
      events: snapshotEvents,
      status: "completed",
      error: "",
    });
  } catch (error) {
    const stopped = await haltIfStopped();
    if (stopped) return stopped;
    const errorText = formatAgentTurnError(error, AGENT_CHAT_TIMEOUT_MS);
    return persistUnlessStopped({
      messages: snapshotMessages,
      events: appendEvents([...snapshotEvents], [
        {
          id: crypto.randomUUID(),
          type: "error",
          title: "Turn failed",
          detail: errorText,
          createdAt: new Date().toISOString(),
          runId: run.id,
        },
      ]),
      status: "failed",
      error: errorText,
    });
  }
}
