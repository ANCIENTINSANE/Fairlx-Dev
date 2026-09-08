import { describe, expect, it } from "vitest";

import type { AgentToolCall } from "../../types";
import {
  azureAuthErrorCode,
  blockedSandboxAuthResult,
  conversationWantsAzureSandbox,
  filterCallsForFailedSandboxAuth,
  formatAzureSandboxAuthError,
  isNonRetryableAzureAuthError,
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
});
