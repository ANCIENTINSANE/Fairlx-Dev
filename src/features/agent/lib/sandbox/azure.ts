import type { SandboxCreateParams, SandboxDriver, SandboxExecResult, SandboxInfo } from "./types";
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
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || `Azure token failed (${response.status})`);
  }
  return json.access_token;
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
    } catch {
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
            ],
          },
          lifecycle: { autoSuspendPolicy: { enabled: true, interval: 900, mode: "Memory" } },
        },
      });
      const id = String(result.json.id || result.json.name || "");
      if (!id) throw new Error("Azure sandbox create returned no id");
      return { id, driver: "azure" };
    } catch (error) {
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
