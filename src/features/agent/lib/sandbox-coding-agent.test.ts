import { afterEach, describe, expect, it } from "vitest";

import { resolveSandboxCodingAgent, sandboxImplementShell } from "./sandbox-coding-agent";

const KEYS = [
  "FAIRLX_SANDBOX_CODING_AGENT",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "AGENT_FOUNDRY_CLAUDE_SONNET_AZURE_API_KEY",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "AGENT_FOUNDRY_AZURE_API_KEY",
];

describe("sandbox coding agent", () => {
  afterEach(() => {
    for (const key of KEYS) delete process.env[key];
  });

  it("prefers Claude Code when Anthropic env exists", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const agent = resolveSandboxCodingAgent();
    expect(agent.id).toBe("claude_code");
    expect(agent.available).toBe(true);
    expect(sandboxImplementShell(agent, "fix the bug")).toMatch(/claude-code/);
  });

  it("falls back to Codex when only OpenAI env exists", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const agent = resolveSandboxCodingAgent();
    expect(agent.id).toBe("codex");
    expect(agent.available).toBe(true);
  });

  it("says specialists when no credentials exist and does not pretend CLIs can run", () => {
    const agent = resolveSandboxCodingAgent();
    expect(agent.id).toBe("specialists");
    expect(agent.available).toBe(false);
    expect(agent.reason).toMatch(/GitHub/);
  });

  it("honors an explicit specialists preference even with keys", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.FAIRLX_SANDBOX_CODING_AGENT = "specialists";
    expect(resolveSandboxCodingAgent().id).toBe("specialists");
  });
});
