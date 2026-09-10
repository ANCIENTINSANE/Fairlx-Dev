import type { AgentToolCall } from "../../types";
import { ensureAzurePreviewUrl } from "../sandbox-preview";
import type { SandboxCreateParams, SandboxDriver, SandboxExecResult, SandboxInfo } from "./types";
import { agentDebugLog } from "./debug-log";
import { redactSecrets } from "./types";
import { isSandboxCwdError, isSandboxGoneError, wrapSandboxShell } from "./workspace";

const API_VERSION = "2026-02-01-preview";
const ADC_SCOPE = "https://dynamicsessions.io/.default";
const ADC_SCOPE_FALLBACK = "https://management.azuredevcompute.io/.default";

type TokenCache = { value: string; expiresAt: number };

/** Data-plane error with the HTTP status and Azure problem `title` (e.g. PortAlreadyExists). */
export class AzureSandboxApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly title?: string,
  ) {
    super(message);
    this.name = "AzureSandboxApiError";
  }
}

type AzurePortEntry = {
  port?: number;
  url?: string;
  auth?: { anonymous?: boolean; entraId?: unknown };
  activationMode?: string;
  protocol?: string;
};

/** True when a port entry is publicly routable (anonymous auth). Anything else 409s at the proxy. */
export function azurePortIsPublic(entry: AzurePortEntry | undefined): boolean {
  return Boolean(entry?.url) && entry?.auth?.anonymous === true;
}

/**
 * Body for POST ports/add. Azure expects `auth: { anonymous: true }` (top-level `anonymous`
 * is ignored and the proxy then answers "Invalid route configuration"). OnDemand activation
 * lets a shared preview link wake a suspended sandbox.
 */
export function azureAddPortBody(port: number): Record<string, unknown> {
  return { port, auth: { anonymous: true }, protocol: "Http", activationMode: "OnDemand" };
}

export type AzureSandboxConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
  resourceGroup: string;
  groupId: string;
  region: string;
  endpoint: string;
  disk: string;
  sessionPoolEndpoint?: string;
};

export function readAzureSandboxConfig(): AzureSandboxConfig | null {
  const tenantId = process.env.AZURE_SANDBOX_TENANT_ID?.trim() || "";
  const clientId = process.env.AZURE_SANDBOX_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.AZURE_SANDBOX_CLIENT_SECRET?.trim() || "";
  const subscriptionId = process.env.AZURE_SANDBOX_SUBSCRIPTION_ID?.trim() || "";
  const resourceGroup = process.env.AZURE_SANDBOX_RESOURCE_GROUP?.trim() || "";
  const groupId = process.env.AZURE_SANDBOX_GROUP_ID?.trim() || "";
  // #region agent log
  agentDebugLog({
    hypothesisId: "A",
    location: "sandbox/azure.ts:readAzureSandboxConfig",
    message: "sandbox env presence",
    data: {
      hasTenant: Boolean(tenantId),
      hasClient: Boolean(clientId),
      hasSecret: Boolean(clientSecret),
      hasSub: Boolean(subscriptionId),
      hasRg: Boolean(resourceGroup),
      hasGroup: Boolean(groupId),
      tenantPrefix: tenantId.slice(0, 8),
      clientPrefix: clientId.slice(0, 8),
      tenantLen: tenantId.length,
      clientLen: clientId.length,
      sessionPool: Boolean(process.env.AZURE_SESSION_POOL_ENDPOINT?.trim()),
      region: process.env.AZURE_SANDBOX_REGION?.trim() || "westus3",
    },
  });
  // #endregion
  if (!tenantId || !clientId || !clientSecret || !subscriptionId || !resourceGroup || !groupId) {
    return null;
  }
  const region = process.env.AZURE_SANDBOX_REGION?.trim() || "westus3";
  const endpoint =
    process.env.AZURE_SANDBOX_ADC_ENDPOINT?.trim() || `https://management.${region}.azuredevcompute.io`;
  return {
    tenantId,
    clientId,
    clientSecret,
    subscriptionId,
    resourceGroup,
    groupId,
    region,
    endpoint: endpoint.replace(/\/+$/, ""),
    disk: process.env.AZURE_SANDBOX_DISK?.trim() || "node",
    sessionPoolEndpoint: process.env.AZURE_SESSION_POOL_ENDPOINT?.trim() || undefined,
  };
}

function groupPath(config: AzureSandboxConfig): string {
  return `/subscriptions/${encodeURIComponent(config.subscriptionId)}/resourceGroups/${encodeURIComponent(
    config.resourceGroup,
  )}/sandboxGroups/${encodeURIComponent(config.groupId)}`;
}

/** Deny-by-default egress plus mirrors needed to `apt-get install git` on public node disks. */
export function azureSandboxEgressHostRules(): { pattern: string; action: "Allow" }[] {
  return [
    { pattern: "github.com", action: "Allow" },
    { pattern: "*.github.com", action: "Allow" },
    { pattern: "registry.npmjs.org", action: "Allow" },
    { pattern: "*.npmjs.org", action: "Allow" },
    { pattern: "pypi.org", action: "Allow" },
    { pattern: "files.pythonhosted.org", action: "Allow" },
    { pattern: "*.azure.com", action: "Allow" },
    { pattern: "*.azure.net", action: "Allow" },
    { pattern: "*.openai.azure.com", action: "Allow" },
    { pattern: "*.services.ai.azure.com", action: "Allow" },
    { pattern: "api.anthropic.com", action: "Allow" },
    { pattern: "*.anthropic.com", action: "Allow" },
    { pattern: "api.openai.com", action: "Allow" },
    { pattern: "*.openai.com", action: "Allow" },
    { pattern: "playwright.azureedge.net", action: "Allow" },
    { pattern: "*.playwright.dev", action: "Allow" },
    { pattern: "*.ubuntu.com", action: "Allow" },
    { pattern: "*.debian.org", action: "Allow" },
    { pattern: "deb.debian.org", action: "Allow" },
    { pattern: "security.debian.org", action: "Allow" },
    { pattern: "*.alpinelinux.org", action: "Allow" },
  ];
}

async function clientCredentialsToken(config: AzureSandboxConfig, scope: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope,
  });
  const response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
    error_codes?: number[];
  };
  // #region agent log
  agentDebugLog({
    hypothesisId: "B",
    location: "sandbox/azure.ts:clientCredentialsToken",
    message: "token endpoint result",
    data: {
      ok: response.ok,
      status: response.status,
      scope,
      tenantPrefix: config.tenantId.slice(0, 8),
      clientPrefix: config.clientId.slice(0, 8),
      azureError: json.error || null,
      errorCodes: json.error_codes || [],
      aadsts: String(json.error_description || "").match(/AADSTS\d+/)?.[0] || null,
      hasAccessToken: Boolean(json.access_token),
    },
  });
  // #endregion
  if (!response.ok || !json.access_token) {
    throw new Error(
      formatAzureSandboxAuthError(json.error_description || `Azure token failed (${response.status})`, config),
    );
  }
  return json.access_token;
}

export function azureAuthErrorCode(text: string): string | null {
  return (text || "").match(/AADSTS\d{5,6}/)?.[0] ?? null;
}

export function isNonRetryableAzureAuthError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error || "");
  return azureAuthErrorCode(text) === "AADSTS700016" || /\b700016\b/.test(text);
}

/** Data-plane 401/403: Entra login worked, but the app has no sandbox role. */
export const AZURE_SANDBOX_RBAC_CODE = "AZURE_SANDBOX_RBAC_403" as const;
export const AZURE_SANDBOX_ROLE = "Container Apps SandboxGroup Data Owner";

export function isAzureSandboxRbacError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error || "");
  return text.includes(AZURE_SANDBOX_RBAC_CODE);
}

/** 700016 (wrong tenant/app) or RBAC 403 (no role). Neither is fixed by retrying blindly. */
export function isAzureSandboxAccessError(error: unknown): boolean {
  return isNonRetryableAzureAuthError(error) || isAzureSandboxRbacError(error);
}

export function azureSandboxFailureCode(text: string): string | null {
  if (isAzureSandboxRbacError(text)) return AZURE_SANDBOX_RBAC_CODE;
  const aad = azureAuthErrorCode(text || "");
  if (aad) return aad;
  return null;
}

export function formatAzureSandboxRbacError(
  status: number,
  config: Pick<AzureSandboxConfig, "clientId" | "subscriptionId" | "resourceGroup" | "groupId">,
): string {
  const scope = `/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}`;
  return [
    `${AZURE_SANDBOX_RBAC_CODE}: Azure sandbox data plane returned ${status}.`,
    `Entra login succeeded, but the app registration (client ${config.clientId.slice(0, 8)}…) has no role on resource group ${config.resourceGroup}, so it cannot create sandboxes in ${config.groupId}.`,
    `Manual step (Azure portal → resource group ${config.resourceGroup} → Access control (IAM) → Add role assignment): grant the role "${AZURE_SANDBOX_ROLE}" to the app registration.`,
    `CLI: az role assignment create --assignee ${config.clientId} --role "${AZURE_SANDBOX_ROLE}" --scope ${scope}`,
    "Owner or Contributor alone does not unlock the data plane. After the role is assigned, ask Fairlx to retry — it re-checks access live.",
  ].join(" ");
}

export function formatAzureSandboxAuthError(description: string, config: Pick<AzureSandboxConfig, "tenantId" | "clientId">): string {
  const code = azureAuthErrorCode(description);
  if (code === "AADSTS700016" || /was not found in the directory/i.test(description)) {
    return [
      "AADSTS700016: Azure sandbox login failed because the app registration is not in this Entra tenant.",
      `AZURE_SANDBOX_CLIENT_ID starts with ${config.clientId.slice(0, 8)} and AZURE_SANDBOX_TENANT_ID starts with ${config.tenantId.slice(0, 8)}.`,
      "Open that same app in Entra ID Overview and set AZURE_SANDBOX_TENANT_ID to its Directory (tenant) ID, or admin-consent the app into this tenant.",
      "Do not retry coding_session_start until those env values match. GitHub Pages is not an Azure sandbox preview.",
    ].join(" ");
  }
  return description;
}

type ScanMessage = { content?: string; role?: string; createdAt?: string };
type ScanEvent = { payload?: unknown; detail?: string; title?: string; type?: string; createdAt?: string };

function structuredSandboxFailure(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as { error?: unknown; code?: unknown; retryable?: unknown };
  const error = typeof rec.error === "string" ? rec.error : "";
  const code = typeof rec.code === "string" ? rec.code : "";
  if (code === "AADSTS700016" || code === AZURE_SANDBOX_RBAC_CODE) return error || code;
  if (rec.retryable === false && isAzureSandboxAccessError(error)) return error;
  if (!code && isAzureSandboxAccessError(error)) return error;
  return null;
}

/**
 * The most recent Azure sandbox access failure reported by a tool in the current turn.
 * Only tool results and sandbox error events count — never assistant or user prose, which
 * routinely quote old error codes and must not re-trigger a block after the env was fixed.
 */
export function lastSandboxAccessFailure(inputs: { events?: ScanEvent[]; messages?: ScanMessage[] }): string | null {
  const messages = inputs.messages ?? [];
  let lastUserAt = "";
  for (const message of messages) {
    if (message.role === "user" && message.createdAt && message.createdAt > lastUserAt) lastUserAt = message.createdAt;
  }
  const inTurn = (createdAt?: string) => !lastUserAt || !createdAt || createdAt >= lastUserAt;
  let found: string | null = null;
  for (const message of messages) {
    if (message.role && message.role !== "tool") continue;
    if (!inTurn(message.createdAt)) continue;
    try {
      const failure = structuredSandboxFailure(JSON.parse(message.content || ""));
      if (failure) found = failure;
    } catch {
      // Not JSON — ignore free text on purpose.
    }
  }
  for (const event of inputs.events ?? []) {
    if (event.type && event.type !== "error") continue;
    if (!inTurn(event.createdAt)) continue;
    const failure = structuredSandboxFailure(event.payload);
    if (failure) found = failure;
  }
  return found;
}

export function runHasNonRetryableSandboxAuth(inputs: { events?: ScanEvent[]; messages?: ScanMessage[] }): boolean {
  return lastSandboxAccessFailure(inputs) !== null;
}

/**
 * Live check that the configured app can reach the sandbox group. Used before a retry so a
 * fixed tenant/role is picked up immediately instead of trusting a stale failure.
 */
export async function probeAzureSandboxAccess(): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = readAzureSandboxConfig();
  if (!config) return { ok: false, error: "Azure sandbox env is incomplete (AZURE_SANDBOX_* values missing)." };
  try {
    const driver = new AzureSandboxDriver(config);
    await driver.probe();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function innerToolName(call: AgentToolCall): string {
  if (call.name !== "mcp_call") return call.name;
  try {
    const parsed = JSON.parse(call.arguments || "{}") as { tool?: string };
    return String(parsed.tool || "").trim() || "mcp_call";
  } catch {
    return "mcp_call";
  }
}

export function filterCallsForFailedSandboxAuth(calls: AgentToolCall[]): {
  allowed: AgentToolCall[];
  blocked: AgentToolCall[];
} {
  const allowed: AgentToolCall[] = [];
  const blocked: AgentToolCall[] = [];
  for (const call of calls) {
    const inner = innerToolName(call);
    if (call.name === "coding_session_start" || inner === "coding_session_start") blocked.push(call);
    else allowed.push(call);
  }
  return { allowed, blocked };
}

export function blockedSandboxAuthResult(call: AgentToolCall, failure?: string | null): string {
  const reason =
    failure ||
    "AADSTS700016: Azure sandbox app is not in this Entra tenant. Fix AZURE_SANDBOX_TENANT_ID and CLIENT_ID so they belong to the same app registration.";
  return JSON.stringify({
    error: `${reason} Do not call coding_session_start again in this turn. Tell the user the exact manual step and that they can say "retry" once it is done — Fairlx re-checks Azure access live. GitHub Pages is not an Azure sandbox preview.`,
    blocked: true,
    retryable: false,
    code: azureSandboxFailureCode(reason) || "AADSTS700016",
    tool: call.name,
  });
}

export const AZURE_SANDBOX_AUTH_USER_MESSAGE =
  "Azure sandbox preview is blocked by AADSTS700016: the app registration is not in this Entra tenant. Set AZURE_SANDBOX_CLIENT_ID and AZURE_SANDBOX_TENANT_ID from the same Entra app registration (Overview → Application ID and Directory ID), or admin-consent that app into this tenant. I will not start another coding session. A GitHub or raw HTML link is not an Azure sandbox preview.";

export function azureSandboxUserMessage(failure?: string | null): string {
  if (!failure || isNonRetryableAzureAuthError(failure)) return AZURE_SANDBOX_AUTH_USER_MESSAGE;
  return `Azure sandbox preview is blocked. ${failure} I will not start another coding session until then — say "retry" after the fix. A GitHub or raw HTML link is not an Azure sandbox preview.`;
}

export function conversationWantsAzureSandbox(text: string): boolean {
  return /\b(azure sandbox|use azure|sandbox preview|azure preview)\b/i.test(text || "");
}

export function rewriteSandboxAuthAssistantContent(params: {
  userText: string;
  assistantText: string;
  hasAuthFailure: boolean;
  failure?: string | null;
}): string {
  if (!params.hasAuthFailure) return params.assistantText;
  if (!conversationWantsAzureSandbox(params.userText)) return params.assistantText;
  return azureSandboxUserMessage(params.failure);
}

export class AzureSandboxDriver implements SandboxDriver {
  readonly kind = "azure" as const;
  private token: TokenCache | null = null;
  private usedFallback = false;
  private poolIds = new Set<string>();
  private prepared = new Set<string>();

  constructor(private readonly config: AzureSandboxConfig) {}

  private async bearer(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    try {
      const value = await clientCredentialsToken(this.config, ADC_SCOPE);
      this.token = { value, expiresAt: Date.now() + 50 * 60 * 1000 };
      return value;
    } catch (error) {
      if (isNonRetryableAzureAuthError(error)) throw error;
      const value = await clientCredentialsToken(this.config, ADC_SCOPE_FALLBACK);
      this.token = { value, expiresAt: Date.now() + 50 * 60 * 1000 };
      return value;
    }
  }

  private async request(
    method: string,
    path: string,
    init?: { json?: unknown; bytes?: Uint8Array; headers?: Record<string, string>; timeoutMs?: number },
  ): Promise<{ status: number; text: string; json: Record<string, unknown> }> {
    const url = `${this.config.endpoint}${path}${path.includes("?") ? "&" : "?"}api-version=${API_VERSION}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.bearer()}`,
      ...(init?.headers ?? {}),
    };
    let body: BodyInit | undefined;
    if (init?.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    } else if (init?.bytes) {
      headers["Content-Type"] = "application/octet-stream";
      body = Buffer.from(init.bytes);
    }
    const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(init?.timeoutMs ?? 120_000) });
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }
    if (!response.ok) {
      const message =
        (typeof json.error === "object" && json.error && "message" in json.error
          ? String((json.error as { message?: string }).message)
          : "") ||
        (typeof json.message === "string" ? json.message : "") ||
        text.slice(0, 400) ||
        `${method} ${path} failed (${response.status})`;
      const title = typeof json.title === "string" ? json.title : undefined;
      if (response.status === 403 || response.status === 401) {
        throw new AzureSandboxApiError(
          `${formatAzureSandboxRbacError(response.status, this.config)}${text.trim() ? ` Azure said: ${text.trim().slice(0, 300)}` : ""}`,
          response.status,
          title,
        );
      }
      throw new AzureSandboxApiError(message, response.status, title);
    }
    return { status: response.status, text, json };
  }

  /** Token + one read against the sandbox group. Throws the same errors create() would. */
  async probe(): Promise<void> {
    await this.request("GET", `${groupPath(this.config)}/sandboxes`);
  }

  async create(params?: SandboxCreateParams): Promise<SandboxInfo> {
    // #region agent log
    agentDebugLog({
      hypothesisId: "D",
      location: "sandbox/azure.ts:create",
      message: "sandbox create start",
      data: {
        hasSessionPool: Boolean(this.config.sessionPoolEndpoint),
        usedFallback: this.usedFallback,
        groupIdLen: this.config.groupId.length,
        endpointHost: this.config.endpoint.replace(/^https?:\/\//, "").split("/")[0],
      },
    });
    // #endregion
    try {
      const result = await this.request("PUT", `${groupPath(this.config)}/sandboxes`, {
        json: {
          sourcesRef: { diskImage: { name: this.config.disk, isPublic: true } },
          resources: { cpu: "1000m", memory: "2048Mi" },
          environment: params?.env ?? {},
          labels: params?.labels ?? {},
          egressPolicy: {
            defaultAction: "Deny",
            trafficInspection: "Full",
            hostRules: azureSandboxEgressHostRules(),
          },
          lifecycle: { autoSuspendPolicy: { enabled: true, interval: 900, mode: "Memory" } },
        },
      });
      const id = String(result.json.id || result.json.name || "");
      if (!id) throw new Error("Azure sandbox create returned no id");
      await this.waitUntilReady(id);
      await this.ensureWorkspace(id);
      return { id, driver: "azure" };
    } catch (error) {
      if (isAzureSandboxAccessError(error)) throw error;
      if (this.config.sessionPoolEndpoint && !this.usedFallback) {
        this.usedFallback = true;
        return this.createSessionPool(params);
      }
      throw error;
    }
  }

  private async createSessionPool(params?: SandboxCreateParams): Promise<SandboxInfo> {
    const endpoint = this.config.sessionPoolEndpoint!.replace(/\/+$/, "");
    const response = await fetch(`${endpoint}/executions?api-version=2024-10-02-preview`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.bearer()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identifier: `fairlx-${crypto.randomUUID()}`,
        sessionIdleTimeoutInSeconds: 900,
        environmentVariables: params?.env,
      }),
    });
    const json = (await response.json().catch(() => ({}))) as { id?: string; identifier?: string };
    if (!response.ok) {
      throw new Error(`Dynamic session fallback failed (${response.status})`);
    }
    const id = String(json.id || json.identifier || "");
    if (id) this.poolIds.add(id);
    return { id, driver: "sessions" };
  }

  private isPool(sandboxId: string): boolean {
    return this.poolIds.has(sandboxId);
  }

  private async execSessionPool(sandboxId: string, command: string, cwd?: string): Promise<SandboxExecResult> {
    const endpoint = this.config.sessionPoolEndpoint!.replace(/\/+$/, "");
    const wrapped = wrapSandboxShell(command, cwd);
    const response = await fetch(`${endpoint}/executions?api-version=2024-10-02-preview`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.bearer()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identifier: sandboxId,
        codeInputType: "inline",
        executionType: "synchronous",
        code: wrapped,
        command: wrapped,
      }),
    });
    const json = (await response.json().catch(() => ({}))) as {
      stdout?: string;
      stderr?: string;
      result?: string;
      error?: string;
      executionResult?: { stdout?: string; stderr?: string; exitCode?: number };
    };
    if (!response.ok) {
      throw new Error(json.error || `Dynamic session exec failed (${response.status})`);
    }
    const stdout = redactSecrets(String(json.executionResult?.stdout ?? json.stdout ?? json.result ?? ""));
    const stderr = redactSecrets(String(json.executionResult?.stderr ?? json.stderr ?? ""));
    return { stdout, stderr, exitCode: Number(json.executionResult?.exitCode ?? 0) };
  }

  async exists(sandboxId: string): Promise<boolean> {
    try {
      await this.request("GET", `${groupPath(this.config)}/sandboxes/${encodeURIComponent(sandboxId)}`);
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error || "");
      if (isSandboxGoneError(error) || /\b404\b/.test(text)) return false;
      throw error;
    }
  }

  private async waitUntilReady(sandboxId: string): Promise<void> {
    // Poll quickly (≤1.5 s apart) for the same ~40 s budget; the old 0.5→6 s back-off routinely
    // left a ready VM idle for several seconds before the clone started.
    for (let attempt = 0; attempt < 32; attempt += 1) {
      if (await this.exists(sandboxId)) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1500, 300 * (attempt + 1))));
    }
    throw new Error(
      `Azure sandbox ${sandboxId} was created but never became ready (GlobalSandboxNotFound). Retry coding_session_start to create a new sandbox.`,
    );
  }

  /**
   * Create /workspace via the files API so the image WORKDIR exists before any shell starts.
   * Sending workingDirectory:/workspace to Azure while the path is missing fails the process
   * before mkdir can run — that is what the agent saw as a "broken CWD".
   */
  async ensureWorkspace(sandboxId: string): Promise<void> {
    if (this.isPool(sandboxId) || this.prepared.has(sandboxId)) return;
    let last: unknown;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await this.writeFile(sandboxId, "/workspace/.fairlx", "ok\n");
        this.prepared.add(sandboxId);
        return;
      } catch (error) {
        last = error;
        if (isSandboxGoneError(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(1200, 300 * (attempt + 1))));
      }
    }
    throw last instanceof Error ? last : new Error("Could not create /workspace in the Azure sandbox.");
  }

  private parseExecResult(json: Record<string, unknown>, text: string): SandboxExecResult {
    const stdout = redactSecrets(String(json.stdout ?? json.output ?? text ?? ""));
    const stderr = redactSecrets(String(json.stderr ?? ""));
    const exitCode = Number(json.exitCode ?? json.exit_code ?? 0);
    return { stdout, stderr, exitCode: Number.isFinite(exitCode) ? exitCode : 0 };
  }

  private async execRaw(sandboxId: string, command: string): Promise<SandboxExecResult> {
    const result = await this.request(
      "POST",
      `${groupPath(this.config)}/sandboxes/${encodeURIComponent(sandboxId)}/executeShellCommand`,
      { json: { command }, timeoutMs: 10 * 60_000 },
    );
    return this.parseExecResult(result.json, result.text);
  }

  async exec(sandboxId: string, command: string, cwd?: string): Promise<SandboxExecResult> {
    if (this.isPool(sandboxId)) return this.execSessionPool(sandboxId, command, cwd);
    await this.ensureWorkspace(sandboxId);
    const wrapped = wrapSandboxShell(command, cwd);
    try {
      return await this.execRaw(sandboxId, wrapped);
    } catch (error) {
      if (!isSandboxCwdError(error)) throw error;
      this.prepared.delete(sandboxId);
      await this.ensureWorkspace(sandboxId);
      return await this.execRaw(sandboxId, wrapped);
    }
  }

  async writeFile(sandboxId: string, path: string, content: string): Promise<void> {
    if (this.isPool(sandboxId)) {
      const payload = JSON.stringify(content);
      await this.execSessionPool(
        sandboxId,
        `python - <<'PY'\nfrom pathlib import Path\np=Path(${JSON.stringify(path)})\np.parent.mkdir(parents=True, exist_ok=True)\np.write_text(${payload}, encoding='utf-8')\nPY`,
      );
      return;
    }
    const encoded = encodeURIComponent(path);
    await this.request(
      "PUT",
      `${groupPath(this.config)}/sandboxes/${encodeURIComponent(sandboxId)}/files?path=${encoded}&createDirs=true`,
      { bytes: new TextEncoder().encode(content) },
    );
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    if (this.isPool(sandboxId)) {
      const result = await this.execSessionPool(
        sandboxId,
        `python -c "from pathlib import Path; print(Path(${JSON.stringify(path)}).read_text())"`,
      );
      if (result.exitCode !== 0) throw new Error(result.stderr || `File not found: ${path}`);
      return result.stdout;
    }
    const encoded = encodeURIComponent(path);
    const result = await this.request(
      "GET",
      `${groupPath(this.config)}/sandboxes/${encodeURIComponent(sandboxId)}/files?path=${encoded}`,
    );
    if (typeof result.json.content === "string") return result.json.content;
    return result.text;
  }

  async exposePort(sandboxId: string, port: number): Promise<string> {
    if (this.isPool(sandboxId)) {
      throw new Error(
        "Preview ports require Azure Container Apps Sandboxes. Dynamic session fallback cannot expose ports.",
      );
    }
    const sandboxPath = `${groupPath(this.config)}/sandboxes/${encodeURIComponent(sandboxId)}`;
    const pick = (json: Record<string, unknown>): AzurePortEntry | undefined => {
      const ports = Array.isArray(json.ports) ? (json.ports as AzurePortEntry[]) : [];
      return ports.find((entry) => Number(entry?.port) === port) ?? ports[ports.length - 1];
    };
    const add = async (): Promise<AzurePortEntry | undefined> => {
      const result = await this.request("POST", `${sandboxPath}/ports/add`, { json: azureAddPortBody(port) });
      return pick(result.json);
    };

    let entry: AzurePortEntry | undefined;
    try {
      entry = await add();
    } catch (error) {
      const exists =
        error instanceof AzureSandboxApiError &&
        (error.status === 409 || /PortAlreadyExists|already exists/i.test(`${error.title ?? ""} ${error.message}`));
      if (!exists) throw error;
      // Port was added earlier (resume/retry). Reuse it; repair it if it was created without anonymous auth.
      const current = await this.request("GET", sandboxPath);
      entry = pick(current.json);
      if (!azurePortIsPublic(entry)) {
        await this.request("POST", `${sandboxPath}/ports/remove`, { json: { port } });
        entry = await add();
      }
    }
    const url = String(entry?.url ?? "");
    if (!url) throw new Error("Azure did not return a preview URL");
    return ensureAzurePreviewUrl(url, sandboxId);
  }

  async suspend(sandboxId: string): Promise<void> {
    if (this.isPool(sandboxId)) return;
    await this.request("POST", `${groupPath(this.config)}/sandboxes/${encodeURIComponent(sandboxId)}/stop`);
  }

  async destroy(sandboxId: string): Promise<void> {
    const pooled = this.isPool(sandboxId);
    this.poolIds.delete(sandboxId);
    this.prepared.delete(sandboxId);
    if (pooled) return;
    await this.request("DELETE", `${groupPath(this.config)}/sandboxes/${encodeURIComponent(sandboxId)}`);
  }
}
