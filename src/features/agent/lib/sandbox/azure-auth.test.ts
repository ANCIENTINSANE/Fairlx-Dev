import { describe, expect, it } from "vitest";

import type { AgentToolCall } from "../../types";
import {
  AzureSandboxApiError,
  azureAddPortBody,
  azureAuthErrorCode,
  azurePortIsPublic,
  azureSandboxEgressHostRules,
  azureSandboxFailureCode,
  blockedSandboxAuthResult,
  conversationWantsAzureSandbox,
  filterCallsForFailedSandboxAuth,
  formatAzureSandboxAuthError,
  formatAzureSandboxRbacError,
  isAzureSandboxAccessError,
  isAzureSandboxRbacError,
  isNonRetryableAzureAuthError,
  lastSandboxAccessFailure,
  rewriteSandboxAuthAssistantContent,
  runHasNonRetryableSandboxAuth,
} from "./azure";

function call(name: string): AgentToolCall {
  return { id: "1", name, arguments: "{}" };
}

describe("Azure sandbox auth errors", () => {
  it("maps AADSTS700016 to a non-retryable tenant mismatch", () => {
    const raw =
      "AADSTS700016: Application with identifier 'd5598241-3f62-40c2-8d63-454a692a738b' was not found in the directory 'cec2b0b8-968a-49eb-bdb3-ce05f451513e'.";
    const formatted = formatAzureSandboxAuthError(raw, {
      tenantId: "cec2b0b8-968a-49eb-bdb3-ce05f451513e",
      clientId: "d5598241-3f62-40c2-8d63-454a692a738b",
    });
    expect(azureAuthErrorCode(formatted)).toBe("AADSTS700016");
    expect(isNonRetryableAzureAuthError(formatted)).toBe(true);
    expect(formatted).toMatch(/starts with d5598241/);
    expect(formatted).toMatch(/starts with cec2b0b8/);
    expect(formatted).toMatch(/Do not retry coding_session_start/);
    expect(formatted).not.toMatch(/GitHub Pages is an Azure/);
  });

  it("blocks another coding_session_start after 700016 is already in the run", () => {
    expect(
      runHasNonRetryableSandboxAuth({
        messages: [{ content: JSON.stringify({ error: "AADSTS700016: Azure sandbox login failed", retryable: false }) }],
      }),
    ).toBe(true);
    const { allowed, blocked } = filterCallsForFailedSandboxAuth([
      call("coding_session_start"),
      call("coding_session_status"),
    ]);
    expect(blocked.map((item) => item.name)).toEqual(["coding_session_start"]);
    expect(allowed.map((item) => item.name)).toEqual(["coding_session_status"]);
    const wrapped = filterCallsForFailedSandboxAuth([
      { id: "2", name: "mcp_call", arguments: JSON.stringify({ tool: "coding_session_start" }) },
      call("github_list_files"),
    ]);
    expect(wrapped.blocked.map((item) => item.name)).toEqual(["mcp_call"]);
    expect(wrapped.allowed.map((item) => item.name)).toEqual(["github_list_files"]);
    expect(JSON.parse(blockedSandboxAuthResult(blocked[0]!)).retryable).toBe(false);
  });

  it("ignores AADSTS700016 quoted in assistant or user prose", () => {
    expect(
      runHasNonRetryableSandboxAuth({
        messages: [
          { role: "user", content: "yesterday it said AADSTS700016, is that fixed?", createdAt: "2026-09-09T10:00:00.000Z" },
          {
            role: "assistant",
            content: "The Azure sandbox is returning a 403 — this is the known AADSTS700016 issue.",
            createdAt: "2026-09-09T10:00:01.000Z",
          },
        ],
      }),
    ).toBe(false);
  });

  it("treats a data-plane 403 as an RBAC failure with the Data Owner role in the message", () => {
    const message = formatAzureSandboxRbacError(403, {
      clientId: "eace68ca-aee7-45f8-86f5-1196d646911a",
      subscriptionId: "c168aea1-3bf3-457e-9724-f1416d9ac8cf",
      resourceGroup: "fairlx-sandboxes",
      groupId: "fairlx-sandboxes",
    });
    expect(isAzureSandboxRbacError(message)).toBe(true);
    expect(isAzureSandboxAccessError(message)).toBe(true);
    expect(isNonRetryableAzureAuthError(message)).toBe(false);
    expect(azureSandboxFailureCode(message)).toBe("AZURE_SANDBOX_RBAC_403");
    expect(message).toMatch(/Container Apps SandboxGroup Data Owner/);
    expect(message).toMatch(/az role assignment create --assignee eace68ca/);
    expect(
      lastSandboxAccessFailure({
        messages: [{ role: "tool", content: JSON.stringify({ error: message, retryable: false, code: "AZURE_SANDBOX_RBAC_403" }) }],
      }),
    ).toBe(message);
    expect(blockedSandboxAuthResult(call("coding_session_start"), message)).toMatch(/Data Owner/);
    expect(JSON.parse(blockedSandboxAuthResult(call("coding_session_start"), message)).code).toBe("AZURE_SANDBOX_RBAC_403");
  });

  it("forgets a sandbox failure from an earlier turn so a retry runs live", () => {
    const failure = JSON.stringify({ error: "AADSTS700016: Azure sandbox login failed", retryable: false, code: "AADSTS700016" });
    expect(
      runHasNonRetryableSandboxAuth({
        messages: [
          { role: "tool", content: failure, createdAt: "2026-09-09T10:00:00.000Z" },
          { role: "user", content: "role assigned, retry", createdAt: "2026-09-09T10:05:00.000Z" },
        ],
      }),
    ).toBe(false);
    expect(
      runHasNonRetryableSandboxAuth({
        messages: [
          { role: "user", content: "build it", createdAt: "2026-09-09T10:00:00.000Z" },
          { role: "tool", content: failure, createdAt: "2026-09-09T10:00:05.000Z" },
        ],
      }),
    ).toBe(true);
  });

  it("replaces GitHub/raw preview answers when the user asked for Azure sandbox after 700016", () => {
    const leaked =
      "Live preview: https://raw.githubusercontent.com/ANCIENTINSANE/agent-harness/feat/landing-page/index.html";
    expect(
      rewriteSandboxAuthAssistantContent({
        userText: "use azure sandbox",
        assistantText: leaked,
        hasAuthFailure: true,
      }),
    ).toMatch(/AADSTS700016/);
    expect(
      rewriteSandboxAuthAssistantContent({
        userText: "use azure sandbox",
        assistantText: leaked,
        hasAuthFailure: true,
      }),
    ).not.toMatch(/raw\.githubusercontent/);
    expect(
      rewriteSandboxAuthAssistantContent({
        userText: "merge the PR",
        assistantText: leaked,
        hasAuthFailure: true,
      }),
    ).toBe(leaked);
    expect(conversationWantsAzureSandbox("use azure sandbox")).toBe(true);
  });

  it("exposes ports with anonymous auth in the shape Azure expects", () => {
    // `{ port, anonymous: true }` is silently ignored by Azure and the proxy returns 409
    // "Invalid route configuration"; the SDK sends auth.anonymous.
    expect(azureAddPortBody(3000)).toEqual({
      port: 3000,
      auth: { anonymous: true },
      protocol: "Http",
      activationMode: "OnDemand",
    });
    expect(azurePortIsPublic({ port: 3000, url: "https://x", auth: { anonymous: true } })).toBe(true);
    expect(azurePortIsPublic({ port: 3000, url: "https://x", activationMode: "Manual" })).toBe(false);
    expect(azurePortIsPublic(undefined)).toBe(false);
    const err = new AzureSandboxApiError("Port 3000 already exists on this sandbox", 409, "PortAlreadyExists");
    expect(err.status).toBe(409);
    expect(err.title).toBe("PortAlreadyExists");
  });

  it("allows apt/apk mirrors so the sandbox can install git on public node disks", () => {
    const patterns = azureSandboxEgressHostRules().map((rule) => rule.pattern);
    expect(patterns).toContain("*.debian.org");
    expect(patterns).toContain("*.ubuntu.com");
    expect(patterns).toContain("*.alpinelinux.org");
    expect(patterns).toContain("github.com");
  });
});
