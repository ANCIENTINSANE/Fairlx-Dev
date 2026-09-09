import type {
  AgentModel,
  AgentProviderStored,
  AgentProviderType,
  AgentSkill,
  AgentWorkPattern,
  McpServerConfig,
} from "./types";
import { workingContextWindow } from "./lib/model-context";

export const AGENT_MCP_QUERY_KEY = ["agent-mcp-config"] as const;
export const AGENT_AI_QUERY_KEY = ["agent-ai-config"] as const;
export const AGENT_RUNS_QUERY_KEY = ["agent-runs"] as const;
export const AGENT_HARNESS_QUERY_KEY = ["agent-harness"] as const;
export const AGENT_CONTEXT_QUERY_KEY = ["agent-context"] as const;
export const AGENT_BRIEFING_QUERY_KEY = ["agent-briefing"] as const;
export const PERSONAL_AGENT_QUERY_KEY = ["personal-agent"] as const;
export const AGENT_PLUGINS_QUERY_KEY = ["agent-plugins"] as const;
export const AGENT_JOBS_QUERY_KEY = ["agent-jobs"] as const;
export const AGENT_CODING_SESSIONS_QUERY_KEY = ["agent-coding-sessions"] as const;

export const PLATFORM_XAI_PROVIDER_ID = "platform-xai";
export const PLATFORM_DEEPSEEK_PROVIDER_ID = "platform-deepseek";
export const PLATFORM_FOUNDRY_PROVIDER_ID = "platform-foundry";
export const GROK_46_MODEL_ID = "grok-4.6";
export const DEEPSEEK_FLASH_MODEL_ID = "deepseek-flash";
export const DEEPSEEK_PRO_MODEL_ID = "deepseek-pro";
export const FOUNDRY_GPT_LUNA_MODEL_ID = "gpt-5.6-luna";
export const FOUNDRY_GPT54_MODEL_ID = "gpt-5.4";
export const FOUNDRY_GPT55_MODEL_ID = "gpt-5.5";
export const FOUNDRY_GPT_SOL_MODEL_ID = "gpt-5.6-sol";
export const FOUNDRY_CLAUDE_SONNET_MODEL_ID = "claude-sonnet";
export const FOUNDRY_CLAUDE_OPUS_MODEL_ID = "claude-opus";
export const LEGACY_FOUNDRY_DEEPSEEK_MODEL_ID = "foundry-deepseek-v4";

export const DEFAULT_FAIRLX_MCP_SERVER_NAME = "fairlx";
export const PERSONAL_MCP_SERVER_NAME = "fairlx-personal";
export const PERSONAL_MCP_URL = "in-process://personal";

export function isInternalMcpServer(name: string, server?: McpServerConfig): boolean {
  if (name === DEFAULT_FAIRLX_MCP_SERVER_NAME || name === PERSONAL_MCP_SERVER_NAME) return true;
  const url = String(server?.url || "");
  if (url === PERSONAL_MCP_URL || url === "/api/mcp" || url.endsWith("/api/mcp")) return true;
  return false;
}

export const PROVIDER_CATALOG: Array<{
  type: AgentProviderType;
  label: string;
  icon: string;
  defaultBaseUrl?: string;
  needsBaseUrl?: boolean;
}> = [
  { type: "anthropic", label: "Anthropic", icon: "fa-solid fa-brain" },
  { type: "azure", label: "Azure", icon: "fa-solid fa-cloud", needsBaseUrl: true },
  { type: "google", label: "Google", icon: "fa-brands fa-google" },
  { type: "openai", label: "OpenAI", icon: "fa-solid fa-microchip" },
  { type: "openrouter", label: "Open Router", icon: "fa-solid fa-route", defaultBaseUrl: "https://openrouter.ai/api/v1" },
  { type: "xai", label: "xAI", icon: "fa-solid fa-bolt", defaultBaseUrl: "https://api.x.ai/v1" },
  { type: "ollama", label: "Ollama", icon: "fa-solid fa-server", defaultBaseUrl: "http://localhost:11434", needsBaseUrl: true },
  { type: "custom", label: "Custom", icon: "fa-solid fa-plug", needsBaseUrl: true },
];

export function isPlatformGrokEnabled(): boolean {
  if (typeof process !== "undefined" && process.env) {
    if (process.env.ENABLE_PLATFORM_GROK === "true") return true;
    if (process.env.ENABLE_PLATFORM_GROK === "false") return false;
    if (process.env.NODE_ENV === "production") return false;
  }
  return true;
}

export const PLATFORM_XAI_PROVIDER: AgentProviderStored = {
  id: PLATFORM_XAI_PROVIDER_ID,
  provider: "azure",
  displayName: "Azure Grok (Fairlx)",
  baseUrl: "https://personal-use-g1-resource.openai.azure.com",
  extra: {
    vendor: "azure",
    deployment: "grok-4.6",
    openaiPath: "/openai/v1",
    authHeader: "api-key",
  },
  isEnabled: true,
  isPlatform: true,
};

export const PLATFORM_DEEPSEEK_PROVIDER: AgentProviderStored = {
  id: PLATFORM_DEEPSEEK_PROVIDER_ID,
  provider: "azure",
  displayName: "Azure DeepSeek (Fairlx)",
  baseUrl: "https://projectfairlx-resource.services.ai.azure.com/api/projects/projectfairlx",
  extra: {
    vendor: "azure",
    deployment: "DeepSeek-V4-Flash",
    openaiPath: "/openai/v1",
    authHeader: "api-key",
    project: "projectfairlx",
  },
  isEnabled: true,
  isPlatform: true,
};

export const PLATFORM_FOUNDRY_PROVIDER: AgentProviderStored = {
  id: PLATFORM_FOUNDRY_PROVIDER_ID,
  provider: "azure",
  displayName: "Azure Foundry (Fairlx)",
  baseUrl: "https://projectfairlx-resource.services.ai.azure.com",
  extra: {
    vendor: "azure",
    deployment: "gpt-5.6-luna",
    openaiPath: "/openai/v1",
    authHeader: "api-key",
    api: "responses",
  },
  isEnabled: true,
  isPlatform: true,
};

export const PLATFORM_GROK_MODEL: AgentModel = {
  id: GROK_46_MODEL_ID,
  providerId: PLATFORM_XAI_PROVIDER_ID,
  modelId: "grok-4.6",
  displayName: "Grok 4.6",
  role: "default",
  isEnabled: true,
  isPlatform: true,
  toolCalling: true,
  vision: true,
  ...workingContextWindow("grok-4.6"),
};

export const PLATFORM_DEEPSEEK_MODEL: AgentModel = {
  id: DEEPSEEK_FLASH_MODEL_ID,
  providerId: PLATFORM_DEEPSEEK_PROVIDER_ID,
  modelId: "DeepSeek-V4-Flash",
  displayName: "DeepSeek V4 Flash",
  role: "default",
  isEnabled: true,
  isPlatform: true,
  toolCalling: true,
  vision: true,
  ...workingContextWindow("DeepSeek-V4-Flash"),
};

export const PLATFORM_DEEPSEEK_PRO_MODEL: AgentModel = {
  id: DEEPSEEK_PRO_MODEL_ID,
  providerId: PLATFORM_DEEPSEEK_PROVIDER_ID,
  modelId: "DeepSeek-V4-Pro",
  displayName: "DeepSeek V4 Pro",
  role: "custom",
  isEnabled: true,
  isPlatform: true,
  toolCalling: true,
  vision: true,
  ...workingContextWindow("DeepSeek-V4-Pro"),
};

export const PLATFORM_FOUNDRY_MODEL: AgentModel = {
  id: FOUNDRY_GPT_LUNA_MODEL_ID,
  providerId: PLATFORM_FOUNDRY_PROVIDER_ID,
  modelId: "gpt-5.6-luna",
  displayName: "GPT-5.6 Luna",
  role: "custom",
  isEnabled: true,
  isPlatform: true,
  toolCalling: true,
  vision: true,
  ...workingContextWindow("gpt-5.6-luna"),
};

export type ExtraFoundrySpec = {
  id: string;
  displayName: string;
  defaultDeployment: string;
  deploymentEnv: string;
  apiKeyEnv: string;
  endpointEnv: string;
};

export const EXTRA_FOUNDRY_SPECS: ExtraFoundrySpec[] = [
  {
    id: FOUNDRY_GPT54_MODEL_ID,
    displayName: "GPT-5.4",
    defaultDeployment: "gpt-5.4",
    deploymentEnv: "AGENT_FOUNDRY_GPT54_AZURE_DEPLOYMENT",
    apiKeyEnv: "AGENT_FOUNDRY_GPT54_AZURE_API_KEY",
    endpointEnv: "AGENT_FOUNDRY_GPT54_AZURE_ENDPOINT",
  },
  {
    id: FOUNDRY_GPT55_MODEL_ID,
    displayName: "GPT-5.5",
    defaultDeployment: "gpt-5.5",
    deploymentEnv: "AGENT_FOUNDRY_GPT55_AZURE_DEPLOYMENT",
    apiKeyEnv: "AGENT_FOUNDRY_GPT55_AZURE_API_KEY",
    endpointEnv: "AGENT_FOUNDRY_GPT55_AZURE_ENDPOINT",
  },
  {
    id: FOUNDRY_GPT_SOL_MODEL_ID,
    displayName: "GPT-5.6 Sol",
    defaultDeployment: "gpt-5.6-sol",
    deploymentEnv: "AGENT_FOUNDRY_SOL_AZURE_DEPLOYMENT",
    apiKeyEnv: "AGENT_FOUNDRY_SOL_AZURE_API_KEY",
    endpointEnv: "AGENT_FOUNDRY_SOL_AZURE_ENDPOINT",
  },
  {
    id: FOUNDRY_CLAUDE_SONNET_MODEL_ID,
    displayName: "Claude Sonnet",
    defaultDeployment: "claude-sonnet",
    deploymentEnv: "AGENT_FOUNDRY_CLAUDE_SONNET_AZURE_DEPLOYMENT",
    apiKeyEnv: "AGENT_FOUNDRY_CLAUDE_SONNET_AZURE_API_KEY",
    endpointEnv: "AGENT_FOUNDRY_CLAUDE_SONNET_AZURE_ENDPOINT",
  },
  {
    id: FOUNDRY_CLAUDE_OPUS_MODEL_ID,
    displayName: "Claude Opus",
    defaultDeployment: "claude-opus",
    deploymentEnv: "AGENT_FOUNDRY_CLAUDE_OPUS_AZURE_DEPLOYMENT",
    apiKeyEnv: "AGENT_FOUNDRY_CLAUDE_OPUS_AZURE_API_KEY",
    endpointEnv: "AGENT_FOUNDRY_CLAUDE_OPUS_AZURE_ENDPOINT",
  },
];

/** Azure OpenAI keys are long alphanumeric; deployment names are short ids like gpt-5.6-sol. */
export function looksLikeAzureApiKey(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 40) return false;
  if (/[./:]/.test(trimmed)) return false;
  return /^[A-Za-z0-9_-]+$/.test(trimmed);
}

export type ExtraFoundryResolved = {
  id: string;
  displayName: string;
  deployment: string;
  apiKey: string;
  endpoint: string;
};

export function resolveExtraFoundryEnv(spec: ExtraFoundrySpec): ExtraFoundryResolved | null {
  const rawDeployment = process.env[spec.deploymentEnv]?.trim() || "";
  const dedicatedKey = process.env[spec.apiKeyEnv]?.trim() || "";
  const dedicatedEndpoint = process.env[spec.endpointEnv]?.trim() || "";
  const misplacedKey = rawDeployment && looksLikeAzureApiKey(rawDeployment) ? rawDeployment : "";
  const namedDeployment = misplacedKey ? "" : rawDeployment;
  if (!namedDeployment && !dedicatedKey && !misplacedKey && !dedicatedEndpoint) return null;
  return {
    id: spec.id,
    displayName: spec.displayName,
    deployment: namedDeployment || spec.defaultDeployment,
    apiKey: dedicatedKey || misplacedKey,
    endpoint: dedicatedEndpoint,
  };
}

export function resolveExtraFoundrySpec(modelId: string): ExtraFoundryResolved | null {
  const spec = EXTRA_FOUNDRY_SPECS.find((item) => item.id === modelId);
  if (!spec) return null;
  return resolveExtraFoundryEnv(spec);
}

export function extraFoundryModels(): AgentModel[] {
  return EXTRA_FOUNDRY_SPECS.flatMap((spec) => {
    const resolved = resolveExtraFoundryEnv(spec);
    if (!resolved) return [];
    return [
      {
        id: spec.id,
        providerId: PLATFORM_FOUNDRY_PROVIDER_ID,
        modelId: resolved.deployment,
        displayName: spec.displayName,
        role: "custom" as const,
        isEnabled: true,
        isPlatform: true,
        toolCalling: true,
        vision: true,
        ...workingContextWindow(resolved.deployment),
      },
    ];
  });
}

export function getPlatformProviders(): AgentProviderStored[] {
  if (isPlatformGrokEnabled()) {
    return [PLATFORM_XAI_PROVIDER, PLATFORM_FOUNDRY_PROVIDER, PLATFORM_DEEPSEEK_PROVIDER];
  }
  return [PLATFORM_FOUNDRY_PROVIDER, PLATFORM_DEEPSEEK_PROVIDER];
}

export function getPlatformModels(): AgentModel[] {
  const extra = extraFoundryModels();
  if (isPlatformGrokEnabled()) {
    return [
      PLATFORM_GROK_MODEL,
      { ...PLATFORM_FOUNDRY_MODEL, role: "custom" },
      { ...PLATFORM_DEEPSEEK_MODEL, role: "flash" },
      PLATFORM_DEEPSEEK_PRO_MODEL,
      ...extra,
    ];
  }
  return [
    { ...PLATFORM_FOUNDRY_MODEL, role: "custom" },
    { ...PLATFORM_DEEPSEEK_MODEL, role: "default" },
    PLATFORM_DEEPSEEK_PRO_MODEL,
    ...extra,
  ];
}

export function getPlatformDefaultModelId(): string {
  return isPlatformGrokEnabled() ? GROK_46_MODEL_ID : DEEPSEEK_FLASH_MODEL_ID;
}

// Public Azure resource URLs only. API keys live in server env (AGENT_*_AZURE_API_KEY).
export const PLATFORM_PROVIDERS: AgentProviderStored[] = [
  PLATFORM_XAI_PROVIDER,
  PLATFORM_FOUNDRY_PROVIDER,
  PLATFORM_DEEPSEEK_PROVIDER,
];

export const PLATFORM_MODELS: AgentModel[] = [
  PLATFORM_GROK_MODEL,
  { ...PLATFORM_FOUNDRY_MODEL, role: "custom" },
  { ...PLATFORM_DEEPSEEK_MODEL, role: "flash" },
  PLATFORM_DEEPSEEK_PRO_MODEL,
];

export function getMcpServerIcon(name: string): { kind: "icon" | "badge"; value: string; className?: string } {
  const key = name.toLowerCase();
  if (key.includes("github")) return { kind: "icon", value: "fa-brands fa-github", className: "text-foreground" };
  if (key.includes("postgres") || key.includes("pgsql") || key.includes("database")) {
    return { kind: "icon", value: "fa-solid fa-database", className: "text-blue-500" };
  }
  if (key.includes("slack")) return { kind: "icon", value: "fa-brands fa-slack", className: "text-foreground" };
  if (key.includes("linear")) return { kind: "icon", value: "fa-solid fa-chart-gantt", className: "text-foreground" };
  if (key.includes("notion")) return { kind: "badge", value: "N" };
  if (key.includes("fairlx") || key.includes("personal")) return { kind: "icon", value: "fa-solid fa-cube", className: "text-primary" };
  return { kind: "icon", value: "fa-solid fa-server", className: "text-muted-foreground" };
}

export function getProviderCatalogItem(type: AgentProviderType) {
  return PROVIDER_CATALOG.find((item) => item.type === type);
}

export const AGENT_NAV = [
  { href: "/agent/dashboard", label: "Agent Home", icon: "fa-solid fa-house-chimney", shortcut: "⌘H" },
  { href: "/agent/chats", label: "Chats", icon: "fa-regular fa-comments" },
  { href: "/agent/projects", label: "Projects", icon: "fa-solid fa-folder" },
  { href: "/agent/workspaces", label: "Workspaces", icon: "fa-solid fa-briefcase" },
  { href: "/agent/git", label: "Git & staging", icon: "fa-solid fa-code-merge" },
  { href: "/agent/skills", label: "Skills", icon: "fa-solid fa-wrench" },
  { href: "/agent/tools", label: "Tools", icon: "fa-solid fa-screwdriver-wrench" },
  { href: "/agent/mcp", label: "MCP Servers", icon: "fa-solid fa-server" },
  { href: "/agent/automations", label: "Automations", icon: "fa-solid fa-bolt" },
  { href: "/agent/integrations", label: "Integrations", icon: "fa-solid fa-puzzle-piece" },
  { href: "/agent/knowledge", label: "Knowledge Base", icon: "fa-solid fa-book" },
  { href: "/agent/settings", label: "Settings", icon: "fa-solid fa-gear" },
] as const;

export const AGENT_SETTINGS_NAV = [
  { href: "/agent/settings#reset", label: "Reset", icon: "fa-solid fa-rotate-left" },
  { href: "/agent/settings#work-patterns", label: "Work patterns", icon: "fa-solid fa-diagram-project" },
] as const;

export const AGENT_TOOL_CATALOG = [
  {
    id: "code_inspect",
    name: "Code inspector",
    icon: "fa-solid fa-code",
    description: "Inspect work items, repositories, and docs.",
  },
  {
    id: "terminal",
    name: "Terminal",
    icon: "fa-solid fa-terminal",
    description: "Record planned shell commands. Never executed on the Fairlx host.",
  },
  {
    id: "file_search",
    name: "File search",
    icon: "fa-solid fa-file-magnifying-glass",
    description: "Search Fairlx docs and work items.",
  },
  {
    id: "web_search",
    name: "Web search",
    icon: "fa-solid fa-globe",
    description: "Search Wikipedia and the public web for research.",
  },
  {
    id: "web_fetch",
    name: "Fetch page",
    icon: "fa-solid fa-file-lines",
    description: "Fetch a public web page for research. Use after web search.",
  },
  {
    id: "database_query",
    name: "Database queries",
    icon: "fa-solid fa-database",
    description: "Query Fairlx workspaces, projects, items, and docs.",
  },
  {
    id: "use_skill",
    name: "Skills",
    icon: "fa-solid fa-bullseye",
    description: "Apply a saved skill from the harness.",
  },
  {
    id: "list_workspaces",
    name: "List workspaces",
    icon: "fa-solid fa-border-all",
    description: "List your Fairlx workspaces.",
  },
  {
    id: "list_projects",
    name: "List projects",
    icon: "fa-regular fa-folder",
    description: "List projects in your workspaces.",
  },
  {
    id: "list_work_items",
    name: "List work items",
    icon: "fa-regular fa-square-check",
    description: "List work items assigned to you.",
  },
  {
    id: "mcp_list",
    name: "MCP servers",
    icon: "fa-solid fa-server",
    description: "List configured MCP servers.",
  },
  {
    id: "mcp_call",
    name: "Call MCP tool",
    icon: "fa-solid fa-plug",
    description: "Call a tool on Fairlx MCP, personal MCP, or a connected HTTP MCP server.",
  },
  {
    id: "mcp_resources",
    name: "MCP resources",
    icon: "fa-solid fa-layer-group",
    description: "List MCP resources including personal harness content.",
  },
  {
    id: "submit_implementation_plan",
    name: "Submit implementation plan",
    icon: "fa-solid fa-list-check",
    description: "Propose a phased implementation plan. Waits for Accept before coding.",
  },
  {
    id: "delegate_agent",
    name: "Delegate specialist",
    icon: "fa-solid fa-sitemap",
    description: "Hand work to a planner, researcher, builder, git, ops, security, workflow, or reviewer specialist.",
  },
  {
    id: "search_harness",
    name: "Harness search",
    icon: "fa-solid fa-magnifying-glass",
    description: "Search chats, skills, knowledge, work, and MCP across the harness.",
  },
  {
    id: "create_project",
    name: "Create project",
    icon: "fa-regular fa-folder-plus",
    description: "Create a Fairlx project in a workspace you belong to.",
  },
  {
    id: "git_status",
    name: "Git status",
    icon: "fa-brands fa-git-alt",
    description: "Show Fairlx-attached repositories, this user's GitHub.com repos when connected, and the Agent staging buffer.",
  },
  {
    id: "git_stage",
    name: "Git stage",
    icon: "fa-solid fa-plus",
    description: "Stage a planned change in the harness buffer.",
  },
  {
    id: "git_unstage",
    name: "Git unstage",
    icon: "fa-solid fa-minus",
    description: "Remove a change from the staging buffer.",
  },
  {
    id: "git_commit_plan",
    name: "Git commit plan",
    icon: "fa-solid fa-code-commit",
    description: "Mark staged changes as a planned commit. Never runs git on the host.",
  },
  {
    id: "run_automation",
    name: "Run automation",
    icon: "fa-solid fa-bolt",
    description: "Apply a saved harness automation to the current context.",
  },
  {
    id: "personal_read",
    name: "Personal content",
    icon: "fa-regular fa-user",
    description: "Read skills, knowledge, rules, automations, chats, and staging from personal MCP.",
  },
  {
    id: "request_capability",
    name: "Request plugin",
    icon: "fa-solid fa-plug",
    description: "Ask the user to connect a missing plugin such as Outlook, Gmail, or GitHub write access.",
  },
  {
    id: "persist_memory",
    name: "Persist memory",
    icon: "fa-solid fa-brain",
    description: "Store a verified fact in harness STATE for later turns.",
  },
  {
    id: "mail_send",
    name: "Send mail",
    icon: "fa-regular fa-envelope",
    description: "Send email through a connected mail plugin after Accept.",
  },
  {
    id: "github_list_files",
    name: "List repo files",
    icon: "fa-solid fa-folder-tree",
    description: "List files in a linked GitHub repository.",
  },
  {
    id: "github_read_file",
    name: "Read repo file",
    icon: "fa-regular fa-file-code",
    description: "Read a file from a linked GitHub repository.",
  },
  {
    id: "github_write_file",
    name: "Write repo file",
    icon: "fa-solid fa-file-pen",
    description: "Create or update a file on a GitHub branch. Opens no host shell.",
  },
  {
    id: "github_open_pr",
    name: "Open pull request",
    icon: "fa-solid fa-code-pull-request",
    description: "Open a GitHub pull request from a branch.",
  },
  {
    id: "github_merge_pr",
    name: "Merge pull request",
    icon: "fa-solid fa-code-merge",
    description: "Merge a GitHub pull request after Accept.",
  },
  {
    id: "github_request_reviewers",
    name: "Request reviewers",
    icon: "fa-solid fa-user-check",
    description: "Request reviewers on a GitHub pull request.",
  },
  {
    id: "github_account_status",
    name: "GitHub account",
    icon: "fa-brands fa-github",
    description: "Check whether this Fairlx user has GitHub connected.",
  },
  {
    id: "github_list_repos",
    name: "GitHub repos",
    icon: "fa-solid fa-code-branch",
    description: "Search this user's GitHub account repositories, not only Fairlx-attached project links.",
  },
  {
    id: "github_list_owners",
    name: "GitHub owners",
    icon: "fa-solid fa-sitemap",
    description: "List the personal GitHub account and organizations for create-repo.",
  },
  {
    id: "github_create_repo",
    name: "Create GitHub repo",
    icon: "fa-solid fa-plus",
    description: "Create a GitHub repository with a README and link it to this project.",
  },
  {
    id: "github_link_repo",
    name: "Attach GitHub repo",
    icon: "fa-solid fa-link",
    description: "Attach an existing GitHub.com repository to this Fairlx project.",
  },
  {
    id: "github_update_repo",
    name: "Update GitHub repo",
    icon: "fa-solid fa-lock",
    description: "Change GitHub repository visibility, description, or homepage.",
  },
  {
    id: "github_delete_file",
    name: "Delete repo file",
    icon: "fa-regular fa-trash-can",
    description: "Delete a file on a GitHub branch.",
  },
  {
    id: "github_list_prs",
    name: "List pull requests",
    icon: "fa-solid fa-code-pull-request",
    description: "List pull requests in a GitHub repository.",
  },
  {
    id: "github_list_issues",
    name: "List issues",
    icon: "fa-regular fa-circle-dot",
    description: "List GitHub issues in a repository.",
  },
  {
    id: "github_create_issue",
    name: "Create issue",
    icon: "fa-solid fa-circle-plus",
    description: "Create a GitHub issue.",
  },
  {
    id: "github_close_issue",
    name: "Close issue",
    icon: "fa-solid fa-circle-check",
    description: "Close a GitHub issue.",
  },
  {
    id: "github_comment_issue",
    name: "Comment on issue",
    icon: "fa-regular fa-comment",
    description: "Comment on a GitHub issue or pull request.",
  },
  {
    id: "github_list_branches",
    name: "List branches",
    icon: "fa-solid fa-code-branch",
    description: "List branches in a GitHub repository.",
  },
  {
    id: "github_list_releases",
    name: "List releases",
    icon: "fa-solid fa-tag",
    description: "List GitHub releases.",
  },
  {
    id: "coding_session_start",
    name: "Start coding session",
    icon: "fa-solid fa-cloud",
    description: "Clone the linked repo in an Azure sandbox, install, start the app, and wait for a live preview URL.",
  },
  {
    id: "coding_session_exec",
    name: "Sandbox exec",
    icon: "fa-solid fa-terminal",
    description: "Run a command in the coding-session sandbox. Never on the Fairlx host.",
  },
  {
    id: "coding_session_status",
    name: "Session status",
    icon: "fa-solid fa-heart-pulse",
    description: "Get coding session status, live vs stub preview, coding agent, and PR.",
  },
  {
    id: "coding_session_implement",
    name: "Sandbox coding agent",
    icon: "fa-solid fa-robot",
    description: "Run Claude Code or Codex in the Azure sandbox. Fallback is Fairlx specialists in /workspace, not GitHub file dumps.",
  },
  {
    id: "coding_session_browser",
    name: "Sandbox browser",
    icon: "fa-solid fa-camera",
    description: "Capture a screenshot of the running sandbox app.",
  },
  {
    id: "security_review",
    name: "Security review",
    icon: "fa-solid fa-shield-halved",
    description: "Scan linked source for vulnerabilities. Never exploits production.",
  },
  {
    id: "agent_job_status",
    name: "Job status",
    icon: "fa-solid fa-hourglass-half",
    description: "Check a long-running agent job such as a security scan.",
  },
  {
    id: "page_ui",
    name: "Page UI",
    icon: "fa-solid fa-window-restore",
    description: "Change the open Fairlx page view: tab, zoom, filters, selection, or in-app navigation.",
  },
] as const;

export const DEFAULT_ENABLED_TOOLS = AGENT_TOOL_CATALOG.map((tool) => tool.id);

export const NEW_AGENT_TOOL_IDS = [
  "mcp_call",
  "mcp_resources",
  "delegate_agent",
  "submit_implementation_plan",
  "search_harness",
  "create_project",
  "git_status",
  "git_stage",
  "git_unstage",
  "git_commit_plan",
  "run_automation",
  "personal_read",
  "request_capability",
  "persist_memory",
  "mail_send",
  "github_list_files",
  "github_read_file",
  "github_write_file",
  "github_open_pr",
  "github_merge_pr",
  "github_request_reviewers",
  "github_account_status",
  "github_list_repos",
  "github_list_owners",
  "github_create_repo",
  "github_link_repo",
  "github_update_repo",
  "github_delete_file",
  "github_list_prs",
  "github_list_issues",
  "github_create_issue",
  "github_close_issue",
  "github_comment_issue",
  "github_list_branches",
  "github_list_releases",
  "coding_session_start",
  "coding_session_exec",
  "coding_session_status",
  "coding_session_implement",
  "coding_session_browser",
  "security_review",
  "agent_job_status",
  "web_fetch",
  "page_ui",
] as const;

export const STARTER_SKILLS: Omit<AgentSkill, "id" | "createdAt">[] = [
  {
    name: "Frontend",
    description: "UI, React, Next.js, and Tailwind in Fairlx.",
    instructions:
      "Prefer existing Fairlx UI components and fairlx-* tokens. Keep screens dynamic with live data. Avoid mock content and inaccessible markup.",
    enabled: true,
  },
  {
    name: "Backend",
    description: "Hono routes, Appwrite, and Fairlx domain APIs.",
    instructions:
      "Use existing Fairlx collections and RPC patterns. Validate input, return { data } or { error }, and never leak secrets. Prefer session-aware queries.",
    enabled: true,
  },
  {
    name: "DevOps",
    description: "Deployments, env, and operational safety.",
    instructions:
      "Do not execute host shell commands. Record planned commands instead. Never commit .env.local or secrets. Prefer existing setup scripts.",
    enabled: true,
  },
];

export const STARTER_WORK_PATTERNS: Omit<AgentWorkPattern, "id" | "createdAt">[] = [
  {
    name: "Ship small PRs",
    instructions: "Prefer small, reviewable changes. Summarize what changed and why.",
    enabled: true,
  },
  {
    name: "Ask before destructive actions",
    instructions: "Never delete, overwrite, or reset data without an explicit user request.",
    enabled: true,
  },
  {
    name: "Cursor-grade agent loop",
    instructions:
      "Inspect live Fairlx context first. Use MCP and harness tools instead of guessing. Stage planned git changes instead of claiming host execution. Keep answers short and shippable.",
    enabled: true,
  },
];

export const AGENT_FIELD_CLASS =
  "border-border bg-background text-foreground placeholder:text-muted-foreground";
