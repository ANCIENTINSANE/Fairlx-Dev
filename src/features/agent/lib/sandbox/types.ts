export type SandboxExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type SandboxInfo = {
  id: string;
  driver: "azure" | "sessions" | "stub";
  previewUrl?: string;
};

export type SandboxCreateParams = {
  labels?: Record<string, string>;
  env?: Record<string, string>;
};

export interface SandboxDriver {
  readonly kind: SandboxInfo["driver"];
  create(params?: SandboxCreateParams): Promise<SandboxInfo>;
  exec(sandboxId: string, command: string, cwd?: string): Promise<SandboxExecResult>;
  writeFile(sandboxId: string, path: string, content: string): Promise<void>;
  readFile(sandboxId: string, path: string): Promise<string>;
  exposePort(sandboxId: string, port: number): Promise<string>;
  suspend(sandboxId: string): Promise<void>;
  destroy(sandboxId: string): Promise<void>;
  /** False when Azure deleted the VM (portal Stop/Delete) or the id was never provisioned. */
  exists?(sandboxId: string): Promise<boolean>;
}

export function redactSecrets(text: string, extraValues: string[] = []): string {
  let next = text
    .replace(/x-access-token:[^@\s]+@/gi, "x-access-token:***@")
    .replace(/ghp_[A-Za-z0-9]+/g, "ghp_***")
    .replace(/gho_[A-Za-z0-9]+/g, "gho_***")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_***")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-***")
    .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, "sk-***")
    .replace(/\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|CODEX_API_KEY)=([^\s]+)/gi, "$1=***");
  for (const value of extraValues) {
    const token = value.trim();
    if (token.length < 8) continue;
    next = next.split(token).join("***");
  }
  return next;
}
