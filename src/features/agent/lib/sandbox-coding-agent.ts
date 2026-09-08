export type SandboxCodingAgentId = "claude_code" | "codex" | "specialists";

export type SandboxCodingAgent = {
  id: SandboxCodingAgentId;
  available: boolean;
  cli: string;
  env: Record<string, string>;
  reason: string;
};

function env(name: string): string {
  return process.env[name]?.trim() || "";
}

function hasClaudeCredentials(): boolean {
  return Boolean(
    env("ANTHROPIC_API_KEY") ||
      env("CLAUDE_CODE_OAUTH_TOKEN") ||
      env("AGENT_FOUNDRY_CLAUDE_SONNET_AZURE_API_KEY") ||
      env("AGENT_FOUNDRY_CLAUDE_OPUS_AZURE_API_KEY"),
  );
}

function hasCodexCredentials(): boolean {
  return Boolean(
    env("OPENAI_API_KEY") ||
      env("CODEX_API_KEY") ||
      env("AGENT_FOUNDRY_AZURE_API_KEY") ||
      env("AGENT_FOUNDRY_GPT54_AZURE_API_KEY") ||
      env("AGENT_FOUNDRY_SOL_AZURE_API_KEY"),
  );
}

function claudeEnv(): Record<string, string> {
  const next: Record<string, string> = {};
  if (env("ANTHROPIC_API_KEY")) next.ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY");
  if (env("CLAUDE_CODE_OAUTH_TOKEN")) next.CLAUDE_CODE_OAUTH_TOKEN = env("CLAUDE_CODE_OAUTH_TOKEN");
  const foundryKey = env("AGENT_FOUNDRY_CLAUDE_SONNET_AZURE_API_KEY") || env("AGENT_FOUNDRY_CLAUDE_OPUS_AZURE_API_KEY");
  const foundryEndpoint =
    env("AGENT_FOUNDRY_CLAUDE_SONNET_AZURE_ENDPOINT") || env("AGENT_FOUNDRY_CLAUDE_OPUS_AZURE_ENDPOINT");
  if (foundryKey) next.ANTHROPIC_API_KEY = next.ANTHROPIC_API_KEY || foundryKey;
  if (foundryEndpoint) next.ANTHROPIC_BASE_URL = foundryEndpoint;
  return next;
}

function codexEnv(): Record<string, string> {
  const next: Record<string, string> = {};
  const key =
    env("OPENAI_API_KEY") ||
    env("CODEX_API_KEY") ||
    env("AGENT_FOUNDRY_AZURE_API_KEY") ||
    env("AGENT_FOUNDRY_GPT54_AZURE_API_KEY") ||
    env("AGENT_FOUNDRY_SOL_AZURE_API_KEY");
  if (key) next.OPENAI_API_KEY = key;
  const endpoint = env("AGENT_FOUNDRY_AZURE_ENDPOINT") || env("OPENAI_BASE_URL");
  if (endpoint) next.OPENAI_BASE_URL = endpoint;
  return next;
}

export function resolveSandboxCodingAgent(override?: string): SandboxCodingAgent {
  const preference = (override || env("FAIRLX_SANDBOX_CODING_AGENT") || "auto").toLowerCase();
  const claude = hasClaudeCredentials();
  const codex = hasCodexCredentials();

  if (preference === "specialists") {
    return {
      id: "specialists",
      available: false,
      cli: "",
      env: {},
      reason: "FAIRLX_SANDBOX_CODING_AGENT=specialists. Claude Code / Codex will not run; Fairlx specialists are the fallback.",
    };
  }

  if (preference === "claude" || preference === "claude_code") {
    if (!claude) {
      return {
        id: "specialists",
        available: false,
        cli: "",
        env: {},
        reason:
          "Claude Code was requested but ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or Foundry Claude env is missing. Fairlx specialists are the fallback — they will not dump files via the GitHub Contents API while a sandbox is bound.",
      };
    }
    return {
      id: "claude_code",
      available: true,
      cli: "npx --yes @anthropic-ai/claude-code",
      env: claudeEnv(),
      reason: "Claude Code CLI in the sandbox.",
    };
  }

  if (preference === "codex") {
    if (!codex) {
      return {
        id: "specialists",
        available: false,
        cli: "",
        env: {},
        reason:
          "Codex was requested but OPENAI_API_KEY, CODEX_API_KEY, or Foundry GPT env is missing. Fairlx specialists are the fallback — they will not dump files via the GitHub Contents API while a sandbox is bound.",
      };
    }
    return {
      id: "codex",
      available: true,
      cli: "npx --yes @openai/codex",
      env: codexEnv(),
      reason: "Codex CLI in the sandbox.",
    };
  }

  if (claude) {
    return {
      id: "claude_code",
      available: true,
      cli: "npx --yes @anthropic-ai/claude-code",
      env: claudeEnv(),
      reason: "Claude Code CLI (Anthropic or Foundry Claude credentials present).",
    };
  }
  if (codex) {
    return {
      id: "codex",
      available: true,
      cli: "npx --yes @openai/codex",
      env: codexEnv(),
      reason: "Codex CLI (OpenAI or Foundry GPT credentials present).",
    };
  }
  return {
    id: "specialists",
    available: false,
    cli: "",
    env: {},
    reason:
      "No Claude Code or Codex credentials. Set ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN or OPENAI_API_KEY. Fairlx specialists can exec in /workspace as a fallback; they will not silently write GitHub files while the sandbox is bound.",
  };
}

export function sandboxImplementShell(agent: SandboxCodingAgent, prompt: string): string {
  const escaped = prompt.replace(/'/g, `'\\''`);
  if (agent.id === "claude_code") {
    return `${agent.cli} -p --dangerously-skip-permissions --output-format text '${escaped}'`;
  }
  if (agent.id === "codex") {
    return `${agent.cli} exec --full-auto -C /workspace '${escaped}'`;
  }
  return `echo ${JSON.stringify(agent.reason)}`;
}
