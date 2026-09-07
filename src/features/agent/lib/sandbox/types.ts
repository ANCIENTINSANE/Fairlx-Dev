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
}

export function redactSecrets(text: string): string {
  return text
    .replace(/x-access-token:[^@\s]+@/gi, "x-access-token:***@")
    .replace(/ghp_[A-Za-z0-9]+/g, "ghp_***")
    .replace(/gho_[A-Za-z0-9]+/g, "gho_***")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_***");
}
