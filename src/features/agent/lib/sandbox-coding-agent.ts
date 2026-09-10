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

const CLI_PACKAGE: Record<Exclude<SandboxCodingAgentId, "specialists">, { pkg: string; bin: string }> = {
  claude_code: { pkg: "@anthropic-ai/claude-code", bin: "claude" },
  codex: { pkg: "@openai/codex", bin: "codex" },
};

export const SANDBOX_CLI_READY_MARKER = "/tmp/fairlx-cli-ready";
export const SANDBOX_CLI_INSTALLING_MARKER = "/tmp/fairlx-cli-installing";

/**
 * Install the coding CLI globally in the background while `npm install` runs, so the first
 * `coding_session_implement` does not pay the `npx --yes` download + cold start. Returns "" when
 * there is nothing to prefetch. Safe to run repeatedly: it exits early once the binary exists.
 */
export function sandboxCliPrefetchShell(agent: SandboxCodingAgent): string {
  if (agent.id === "specialists") return "";
  const { pkg, bin } = CLI_PACKAGE[agent.id];
  const inner = [
    `if command -v ${bin} >/dev/null 2>&1; then touch ${SANDBOX_CLI_READY_MARKER}; exit 0; fi`,
    `touch ${SANDBOX_CLI_INSTALLING_MARKER}`,
    `npm install -g --no-audit --no-fund --loglevel=error ${pkg} >/tmp/fairlx-cli.log 2>&1 || true`,
    `rm -f ${SANDBOX_CLI_INSTALLING_MARKER}`,
    `command -v ${bin} >/dev/null 2>&1 && touch ${SANDBOX_CLI_READY_MARKER}`,
  ].join("; ");
  return `if ! command -v ${bin} >/dev/null 2>&1 && [ ! -f ${SANDBOX_CLI_INSTALLING_MARKER} ]; then nohup sh -c ${JSON.stringify(inner)} >/dev/null 2>&1 < /dev/null & fi`;
}

/** Wait (bounded) for an in-flight prefetch, then run the global binary if present, else `npx`. */
function cliInvocation(agent: SandboxCodingAgent, args: string): string {
  if (agent.id === "specialists") return "";
  const { bin } = CLI_PACKAGE[agent.id];
  return [
    `i=0; while [ -f ${SANDBOX_CLI_INSTALLING_MARKER} ] && [ $i -lt 45 ]; do sleep 2; i=$((i+1)); done`,
    `if command -v ${bin} >/dev/null 2>&1; then ${bin} ${args}; else ${agent.cli} ${args}; fi`,
  ].join("\n");
}

export function sandboxImplementShell(agent: SandboxCodingAgent, prompt: string): string {
  const escaped = prompt.replace(/'/g, `'\\''`);
  if (agent.id === "claude_code") {
    return cliInvocation(agent, `-p --dangerously-skip-permissions --output-format text '${escaped}'`);
  }
  if (agent.id === "codex") {
    return cliInvocation(agent, `exec --full-auto -C /workspace '${escaped}'`);
  }
  return `echo ${JSON.stringify(agent.reason)}`;
}
