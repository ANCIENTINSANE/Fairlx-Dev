import { AzureSandboxDriver, readAzureSandboxConfig } from "./azure";
import { agentDebugLog } from "./debug-log";
import { StubSandboxDriver } from "./stub";
import type { SandboxDriver } from "./types";

export type { SandboxDriver, SandboxExecResult, SandboxInfo } from "./types";
export { redactSecrets } from "./types";
export { StubSandboxDriver, resetStubSandboxes } from "./stub";
export { AzureSandboxDriver, readAzureSandboxConfig } from "./azure";
export {
  azureAuthErrorCode,
  blockedSandboxAuthResult,
  filterCallsForFailedSandboxAuth,
  formatAzureSandboxAuthError,
  isNonRetryableAzureAuthError,
  rewriteSandboxAuthAssistantContent,
  runHasNonRetryableSandboxAuth,
} from "./azure";

let cached: SandboxDriver | null = null;

export function getSandboxDriver(): SandboxDriver {
  if (cached) {
    // #region agent log
    agentDebugLog({
      hypothesisId: "C",
      location: "sandbox/index.ts:getSandboxDriver",
      message: "driver cache hit",
      data: { kind: cached.kind, fromCache: true },
    });
    // #endregion
    return cached;
  }
  const config = readAzureSandboxConfig();
  cached = config ? new AzureSandboxDriver(config) : new StubSandboxDriver();
  // #region agent log
  agentDebugLog({
    hypothesisId: "C",
    location: "sandbox/index.ts:getSandboxDriver",
    message: "driver created",
    data: { kind: cached.kind, fromCache: false, hasConfig: Boolean(config) },
  });
  // #endregion
  return cached;
}

export function resetSandboxDriverCache(): void {
  cached = null;
}

export function sandboxDriverKind(): SandboxDriver["kind"] {
  return getSandboxDriver().kind;
}
