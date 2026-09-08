import type { AgentToolCall } from "../../types";
import type { SandboxCreateParams, SandboxDriver, SandboxExecResult, SandboxInfo } from "./types";
import { agentDebugLog } from "./debug-log";
import { redactSecrets } from "./types";

const API_VERSION = "2026-02-01-preview";
const ADC_SCOPE = "https://dynamicsessions.io/.default";
const ADC_SCOPE_FALLBACK = "https://management.azuredevcompute.io/.default";

type TokenCache = { value: string; expiresAt: number };

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

export function runHasNonRetryableSandboxAuth(inputs: {
  events?: Array<{ payload?: unknown; detail?: string; title?: string }>;
  messages?: Array<{ content?: string }>;
}): boolean {
  const chunks: string[] = [];
  for (const event of inputs.events ?? []) {
    chunks.push(event.detail || "", event.title || "", JSON.stringify(event.payload ?? ""));
  }
  for (const message of inputs.messages ?? []) {
    chunks.push(message.content || "");
  }
  return chunks.some((chunk) => isNonRetryableAzureAuthError(chunk));
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

export function blockedSandboxAuthResult(call: AgentToolCall): string {
  return JSON.stringify({
    error:
      "AADSTS700016: Azure sandbox app is not in this Entra tenant. Do not retry coding_session_start. Fix AZURE_SANDBOX_TENANT_ID and CLIENT_ID so they belong to the same app registration. GitHub Pages is not an Azure sandbox preview.",
    blocked: true,
    retryable: false,
    code: "AADSTS700016",
    tool: call.name,
  });
}

export const AZURE_SANDBOX_AUTH_USER_MESSAGE =
  "Azure sandbox preview is blocked by AADSTS700016: the app registration is not in this Entra tenant. Set AZURE_SANDBOX_CLIENT_ID and AZURE_SANDBOX_TENANT_ID from the same Entra app registration (Overview → Application ID and Directory ID), or admin-consent that app into this tenant. I will not start another coding session. A GitHub or raw HTML link is not an Azure sandbox preview.";

export function conversationWantsAzureSandbox(text: string): boolean {
  return /\b(azure sandbox|use azure|sandbox preview|azure preview)\b/i.test(text || "");
}

export function rewriteSandboxAuthAssistantContent(params: {
  userText: string;
  assistantText: string;
  hasAuthFailure: boolean;
}): string {
  if (!params.hasAuthFailure) return params.assistantText;
  if (!conversationWantsAzureSandbox(params.userText)) return params.assistantText;
  return AZURE_SANDBOX_AUTH_USER_MESSAGE;
}

export class AzureSandboxDriver implements SandboxDriver {
  readonly kind = "azure" as const;
  private token: TokenCache | null = null;
  private usedFallback = false;
  private poolIds = new Set<string>();

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
    init?: { json?: unknown; bytes?: Uint8Array; headers?: Record<string, string> },
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
    const response = await fetch(url, { method, headers, body });
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
      throw new Error(message);
    }
    return { status: response.status, text, json };
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
            hostRules: [
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
            ],
          },
          lifecycle: { autoSuspendPolicy: { enabled: true, interval: 900, mode: "Memory" } },
        },
      });
      const id = String(result.json.id || result.json.name || "");
      if (!id) throw new Error("Azure sandbox create returned no id");
      return { id, driver: "azure" };
    } catch (error) {
      if (isNonRetryableAzureAuthError(error)) throw error;
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
    const wrapped = cwd ? `cd ${JSON.stringify(cwd)} && ${command}` : command;
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

  async exec(sandboxId: string, command: string, cwd?: string): Promise<SandboxExecResult> {
    if (this.isPool(sandboxId)) return this.execSessionPool(sandboxId, command, cwd);
    const result = await this.request("POST", `${groupPath(this.config)}/sandboxes/${encodeURIComponent(sandboxId)}/executeShellCommand`, {
      json: {
        command,
        ...(cwd ? { workingDirectory: cwd } : {}),
      },
    });
    const stdout = redactSecrets(String(result.json.stdout ?? result.json.output ?? result.text ?? ""));
    const stderr = redactSecrets(String(result.json.stderr ?? ""));
    const exitCode = Number(result.json.exitCode ?? result.json.exit_code ?? 0);
    return { stdout, stderr, exitCode: Number.isFinite(exitCode) ? exitCode : 0 };
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
    const result = await this.request(
      "POST",
      `${groupPath(this.config)}/sandboxes/${encodeURIComponent(sandboxId)}/ports/add`,
      { json: { port, anonymous: true } },
    );
    const ports = result.json.ports;
    const first = Array.isArray(ports) ? (ports[0] as { url?: string } | undefined) : undefined;
    const url = String(result.json.url ?? first?.url ?? "");
    if (!url) throw new Error("Azure did not return a preview URL");
    return url;
  }

  async suspend(sandboxId: string): Promise<void> {
    if (this.isPool(sandboxId)) return;
    await this.request("POST", `${groupPath(this.config)}/sandboxes/${encodeURIComponent(sandboxId)}/stop`);
  }

  async destroy(sandboxId: string): Promise<void> {
    const pooled = this.isPool(sandboxId);
    this.poolIds.delete(sandboxId);
    if (pooled) return;
    await this.request("DELETE", `${groupPath(this.config)}/sandboxes/${encodeURIComponent(sandboxId)}`);
  }
}
