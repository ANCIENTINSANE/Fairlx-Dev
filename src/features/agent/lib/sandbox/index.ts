import { AzureSandboxDriver, readAzureSandboxConfig } from "./azure";
import { StubSandboxDriver } from "./stub";
import type { SandboxDriver } from "./types";

export type { SandboxDriver, SandboxExecResult, SandboxInfo } from "./types";
export { redactSecrets } from "./types";
export { StubSandboxDriver, resetStubSandboxes } from "./stub";
export { AzureSandboxDriver, readAzureSandboxConfig } from "./azure";

let cached: SandboxDriver | null = null;

export function getSandboxDriver(): SandboxDriver {
  if (cached) return cached;
  const config = readAzureSandboxConfig();
  cached = config ? new AzureSandboxDriver(config) : new StubSandboxDriver();
  return cached;
}

export function resetSandboxDriverCache(): void {
  cached = null;
}

export function sandboxDriverKind(): SandboxDriver["kind"] {
  return getSandboxDriver().kind;
}
