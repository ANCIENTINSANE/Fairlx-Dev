export type McpTransport = "stdio" | "sse" | "http";

export type McpServerConfig = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  transport?: McpTransport;
  disabled?: boolean;
  [key: string]: unknown;
};

export type McpConfig = {
  mcpServers: Record<string, McpServerConfig>;
  [key: string]: unknown;
};

export type AgentProviderType =
  | "anthropic"
  | "azure"
  | "google"
  | "openai"
  | "openrouter"
  | "xai"
  | "ollama"
  | "custom";

export type AgentModelRole = "default" | "flash" | "custom";

export type AgentAiMode = "auto" | "manual";

export type AgentApiKeySource = "none" | "platform" | "user";

export type AgentProviderPublic = {
  id: string;
  provider: AgentProviderType;
  displayName: string;
  apiKeyMasked?: string;
  apiKeyLast4?: string;
  hasApiKey: boolean;
  apiKeySource: AgentApiKeySource;
  baseUrl?: string;
  extra?: Record<string, unknown>;
  isEnabled: boolean;
  isPlatform: boolean;
};

export type AgentProviderInput = {
  id: string;
  provider: AgentProviderType;
  displayName: string;
  apiKey?: string;
  baseUrl?: string;
  extra?: Record<string, unknown>;
  isEnabled?: boolean;
  isPlatform?: boolean;
};

export type AgentProviderStored = {
  id: string;
  provider: AgentProviderType;
  displayName: string;
  apiKeyEncrypted?: string;
  apiKeyLast4?: string;
  baseUrl?: string;
  extra?: Record<string, unknown>;
  isEnabled: boolean;
  isPlatform: boolean;
};

export type AgentModel = {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  role?: AgentModelRole;
  isEnabled: boolean;
  isPlatform: boolean;
  toolCalling?: boolean;
  vision?: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
};

export type AgentAiConfigPublic = {
  mode: AgentAiMode;
  selectedModelId?: string;
  resolvedModelId?: string;
  resolvedModelName?: string;
  providers: AgentProviderPublic[];
  models: AgentModel[];
};

export type AgentAiConfigInput = {
  mode: AgentAiMode;
  selectedModelId?: string;
  providers: AgentProviderInput[];
  models: AgentModel[];
};

export type AgentAiConfigStored = {
  mode: AgentAiMode;
  selectedModelId?: string;
  providers: AgentProviderStored[];
  models: AgentModel[];
};

export type AgentRunStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "awaiting_confirmation"
  | "awaiting_plugin"
  | "awaiting_question";
export type AgentRunMode = "agent" | "manual";
export type AgentSessionMode = "auto" | "agent" | "personal" | "plan" | "debug" | "multitask" | "ask";
export type AgentChatRole = "user" | "assistant" | "tool";

export type AgentToolCall = {
  id: string;
  /** Azure/OpenAI Responses function_call item id (`fc_...`). */
  itemId?: string;
  name: string;
  arguments: string;
};

export type AgentChatMessage = {
  id: string;
  role: AgentChatRole;
  content: string;
  toolCalls?: AgentToolCall[];
  toolCallId?: string;
  toolName?: string;
  createdAt: string;
};

export type AgentSpecialistId =
  | "orchestrator"
  | "planner"
  | "researcher"
  | "builder"
  | "git"
  | "reviewer"
  | "ops"
  | "security"
  | "workflow"
  | "tester";

export type ImplementationPlanTaskStatus = "pending" | "in_progress" | "done" | "blocked";

export type ImplementationPlanTask = {
  id: string;
  title: string;
  status: ImplementationPlanTaskStatus;
  specialist?: AgentSpecialistId;
};

export type ImplementationPlanPhase = {
  id: string;
  title: string;
  tasks: ImplementationPlanTask[];
};

export type ImplementationPlan = {
  title: string;
  summary: string;
  status: "draft" | "accepted" | "rejected";
  phases: ImplementationPlanPhase[];
  repo?: { owner?: string; name?: string; exists?: boolean };
  execution?: { codingSession?: boolean; exposePort?: number; workItemId?: string };
};

export type AgentCapability =
  | "email.send"
  | "code.read"
  | "code.write"
  | "security.review"
  | "members.invite"
  | "chat.notify";

export type AgentPluginAuthKind = "platform" | "oauth" | "token" | "mcp";

export type AgentPluginSecrets = {
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string;
  apiKeyEncrypted?: string;
  clientSecretEncrypted?: string;
  from?: string;
  mcpUrl?: string;
  mcpTool?: string;
  mcpHeadersEncrypted?: string;
  extra?: Record<string, string>;
};

export type AgentPluginConnection = {
  id: string;
  catalogId: string;
  displayName: string;
  capabilities: AgentCapability[];
  status: "connected" | "disconnected";
  authKind: AgentPluginAuthKind;
  secrets?: AgentPluginSecrets;
  createdAt: string;
};

export type AgentPluginPublic = {
  id: string;
  catalogId: string;
  displayName: string;
  capabilities: AgentCapability[];
  status: "connected" | "disconnected";
  authKind: AgentPluginAuthKind;
  hasSecret: boolean;
  from?: string;
  mcpUrl?: string;
  createdAt: string;
};

export type AgentJobKind = "security_review" | "github_pr" | "coding_session" | "personal_standin";
export type AgentJobStatus = "queued" | "scheduled" | "running" | "completed" | "failed" | "cancelled";

export type AgentJob = {
  id: string;
  userId: string;
  runId?: string;
  kind: AgentJobKind;
  status: AgentJobStatus;
  progress: { step: string; percent: number };
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type CodingSessionStatus =
  | "queued"
  | "preparing"
  | "running"
  | "awaiting_review"
  | "iterating"
  | "merging"
  | "merged"
  | "failed"
  | "stopped";

export type CodingSessionEvent = {
  id: string;
  type: string;
  detail?: string;
  payload?: unknown;
  createdAt: string;
};

export type CodingSession = {
  id: string;
  userId: string;
  workItemId: string;
  projectId: string;
  workspaceId: string;
  runId?: string;
  repoId?: string;
  baseBranch?: string;
  headBranch?: string;
  status: CodingSessionStatus;
  sandboxId?: string;
  previewUrl?: string;
  prNumber?: number;
  prUrl?: string;
  orchestratorModelId?: string;
  workerModelId?: string;
  events: CodingSessionEvent[];
  driver?: "azure" | "sessions" | "stub";
  previewLive?: boolean;
  codingAgent?: "claude_code" | "codex" | "specialists";
  codingAgentReason?: string;
  artifacts?: Array<{
    id: string;
    kind: "screenshot" | "recording";
    path: string;
    mime: string;
    createdAt: string;
    note?: string;
  }>;
  meta?: CodingSessionMeta;
  createdAt: string;
  updatedAt: string;
};

export type SandboxLifecycleState = "active" | "paused" | "destroyed";

export type CodingSessionMeta = {
  driver?: "azure" | "sessions" | "stub";
  previewLive?: boolean;
  codingAgent?: "claude_code" | "codex" | "specialists";
  codingAgentReason?: string;
  exposePort?: number;
  startCommand?: string;
  packageManager?: string;
  autoMode?: boolean;
  /** Last time a human or the agent used this sandbox (exec, preview open, chat turn). */
  lastActivityAt?: string;
  /** Idle lifecycle: active → paused (15 min idle) → destroyed (30 min idle). */
  lifecycle?: SandboxLifecycleState;
  pausedAt?: string;
  destroyedAt?: string;
  artifacts?: Array<{
    id: string;
    kind: "screenshot" | "recording";
    path: string;
    mime: string;
    createdAt: string;
    note?: string;
  }>;
};

export type AgentGitStageStatus = "unstaged" | "staged" | "committed";

export type AgentGitStageItem = {
  id: string;
  path: string;
  summary: string;
  status: AgentGitStageStatus;
  repoId?: string;
  branch?: string;
  content?: string;
  createdAt: string;
};

export type AgentGitStaging = {
  items: AgentGitStageItem[];
  updatedAt: string;
};

export type AgentChatMeta = {
  pinnedRunIds: string[];
  archivedRunIds: string[];
};

export type AgentContextGraphNode = {
  id: string;
  kind: "organization" | "workspace" | "project" | "work_item" | "repo" | "mcp" | "specialist";
  label: string;
  parentId?: string;
  meta?: string;
};

export type AgentContextGraph = {
  nodes: AgentContextGraphNode[];
  specialist: AgentSpecialistId;
  workspaceId?: string;
  projectId?: string;
};

export type AgentSearchKind =
  | "run"
  | "workspace"
  | "project"
  | "work_item"
  | "skill"
  | "knowledge"
  | "automation"
  | "pattern"
  | "doc"
  | "repo"
  | "mcp"
  | "staging";

export type AgentSearchHit = {
  id: string;
  kind: AgentSearchKind;
  title: string;
  href: string;
  meta: string;
  score: number;
};

export type AgentPendingConfirmation = {
  calls: AgentToolCall[];
  summary: string;
};

export type AgentToolEventType =
  | "code_inspect"
  | "terminal"
  | "file_search"
  | "web_search"
  | "web_fetch"
  | "database_query"
  | "use_skill"
  | "list_workspaces"
  | "list_projects"
  | "list_work_items"
  | "mcp_list"
  | "mcp_call"
  | "mcp_resources"
  | "delegate_agent"
  | "search_harness"
  | "create_project"
  | "git_status"
  | "git_stage"
  | "git_unstage"
  | "git_commit_plan"
  | "run_automation"
  | "personal_read"
  | "save_personal_agent"
  | "ask_user"
  | "ask_user_resolved"
  | "page_ui"
  | "mail_send"
  | "notify_channel"
  | "github_read_file"
  | "github_list_files"
  | "github_write_file"
  | "github_open_pr"
  | "github_merge_pr"
  | "github_request_reviewers"
  | "github_account_status"
  | "github_list_repos"
  | "github_list_owners"
  | "github_create_repo"
  | "github_link_repo"
  | "github_update_repo"
  | "github_delete_file"
  | "github_list_prs"
  | "github_list_issues"
  | "github_create_issue"
  | "github_close_issue"
  | "github_comment_issue"
  | "github_list_branches"
  | "github_list_releases"
  | "coding_session_start"
  | "coding_session_exec"
  | "coding_session_status"
  | "coding_session_implement"
  | "coding_session_browser"
  | "submit_implementation_plan"
  | "security_review"
  | "request_capability"
  | "persist_memory"
  | "agent_job_status"
  | "plugin_required"
  | "plugin_connected"
  | "job_progress"
  | "thought"
  | "model_route"
  | "tool_start"
  | "subagent_started"
  | "subagent_progress"
  | "subagent_done"
  | "context_meter"
  | "confirmation"
  | "confirmation_resolved"
  | "llm_usage"
  | "error";

export type AgentToolEvent = {
  id: string;
  type: AgentToolEventType;
  title: string;
  detail?: string;
  payload?: unknown;
  createdAt: string;
  runId: string;
  /** Set on tool result events so the UI can pair them with the preceding `tool_start`. */
  toolCallId?: string;
};

export type AgentLlmUsagePayload = {
  role: "orchestrator" | "subagent";
  specialist?: string;
  subagentId?: string;
  iteration?: number;
  operationId: string;
  model: string;
  modelId: string;
  displayName: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimated: boolean;
  billed: boolean;
  inputPricePerMillionTokens: number;
  outputPricePerMillionTokens: number;
  cachedInputPricePerMillionTokens: number;
  providerCostUSD: number;
  costUSD: number;
  markup: number;
  cacheHitPercent: number;
  pricingSource?: string;
};

export type AgentRun = {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  status: AgentRunStatus;
  mode: AgentRunMode;
  workspaceId?: string;
  projectId?: string;
  modelId?: string;
  messages: AgentChatMessage[];
  events: AgentToolEvent[];
  error?: string;
  kind?: "chat" | "training" | "coding_session" | "automation";
  sessionId?: string;
  autonomousCoding?: boolean;
  automationId?: string;
  implementationPlan?: ImplementationPlan;
  contextPeak?: {
    conversation: number;
    summarized_conversation: number;
  };
  createdAt: string;
  updatedAt: string;
};

export type AgentSkill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  createdAt: string;
};

export type AutomationTriggerKind =
  | "work_item_created"
  | "work_item_status"
  | "work_item_assigned"
  | "comment_mention"
  | "chat_mention"
  | "manual";

export type AutomationNodeKind =
  | "trigger"
  | "agent"
  | "test"
  | "deploy"
  | "notify"
  | "supervisor"
  | "close";

export type AutomationNotifyChannel = "slack" | "discord" | "teams" | "email" | "in_app";

/** One node on the automation canvas. `config` is kind-specific and kept flat for the 16KB harness column. */
export type AutomationNode = {
  id: string;
  kind: AutomationNodeKind;
  label?: string;
  x: number;
  y: number;
  config: Record<string, string | number | boolean | string[]>;
};

export type AutomationEdge = {
  id: string;
  from: string;
  to: string;
  /** Which outcome of `from` follows this edge. Default `always`. */
  when?: "always" | "pass" | "fail";
};

export type AutomationFlow = {
  version: 1;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
};

export type AgentAutomation = {
  id: string;
  name: string;
  description: string;
  trigger: string;
  action: string;
  enabled: boolean;
  createdAt: string;
  /** React-Flow style loop. When present it replaces the free-text trigger/action. */
  flow?: AutomationFlow;
  /** Scope the trigger. Empty = every workspace/project this user can see. */
  workspaceId?: string;
  projectId?: string;
  lastRunAt?: string;
  runCount?: number;
};

export type AgentKnowledgeItem = {
  id: string;
  title: string;
  content: string;
  source?: string;
  createdAt: string;
};

export type AgentWorkPattern = {
  id: string;
  name: string;
  instructions: string;
  enabled: boolean;
  createdAt: string;
};

export type AgentPermissionType = "staged" | "all_access";
export type AgentWriteRisk = "read" | "standard" | "privileged";

export type AgentHarnessSettings = {
  mode: AgentRunMode;
  enabledTools: string[];
  defaultWorkspaceId?: string;
  defaultProjectId?: string;
  sessionMode?: AgentSessionMode;
  permissionType?: AgentPermissionType;
  /** When true, skip extra Accepts on the coding loop (plan/start/PR/merge). Default stays staged. */
  autonomousCoding?: boolean;
};

export type AgentContextChipKind =
  | "workspace"
  | "project"
  | "work_item"
  | "skill"
  | "mcp"
  | "file"
  | "image"
  | "doc"
  | "repo"
  | "knowledge";

export type AgentContextChip = {
  kind: AgentContextChipKind;
  id: string;
  label: string;
  meta?: string;
  /** Text body for attached markdown/code, or a data URL for pasted images. */
  content?: string;
};

export type AgentHarness = {
  id: string;
  userId: string;
  skills: AgentSkill[];
  automations: AgentAutomation[];
  knowledge: AgentKnowledgeItem[];
  workPatterns: AgentWorkPattern[];
  settings: AgentHarnessSettings;
  gitStaging: AgentGitStaging;
  chatMeta: AgentChatMeta;
  plugins: AgentPluginConnection[];
  updatedAt: string;
};

export type AgentContextWorkspace = {
  id: string;
  name: string;
  imageUrl?: string;
  inviteCode?: string;
  role?: string;
  organizationId?: string;
};

export type AgentContextOrganization = {
  id: string;
  name: string;
  role?: string;
  status?: string;
};

export type AgentContextProject = {
  id: string;
  name: string;
  imageUrl?: string;
  workspaceId: string;
  description?: string;
  status?: string;
  key?: string;
  customLabels?: Array<{ name: string; color?: string }>;
};

export type AgentContextWorkItem = {
  id: string;
  key?: string;
  title: string;
  type?: string;
  status?: string;
  priority?: string;
  workspaceId?: string;
  projectId?: string;
  labels?: string[];
  dueDate?: string;
  flagged?: boolean;
  createdAt?: string;
};

export type AgentContextNotification = {
  id: string;
  title?: string;
  message?: string;
  isRead?: boolean;
  workspaceId?: string;
  createdAt: string;
};

export type AgentContextRepo = {
  id: string;
  repositoryName?: string;
  owner?: string;
  githubUrl?: string;
  workspaceId?: string;
  projectId?: string;
  branch?: string;
};

export type AgentContextIntegration = {
  id: string;
  provider?: string;
  projectId?: string;
  workspaceId?: string;
  name?: string;
};

export type AgentContextDoc = {
  id: string;
  title?: string;
  name?: string;
  description?: string;
  projectId?: string;
  workspaceId?: string;
  category?: string;
};

export type AgentContext = {
  user: {
    id: string;
    name: string;
    email: string;
  };
  workspaces: AgentContextWorkspace[];
  projects: AgentContextProject[];
  workItems: AgentContextWorkItem[];
  notifications: AgentContextNotification[];
  githubRepos: AgentContextRepo[];
  githubAccount?: {
    connected: boolean;
    login?: string;
    hasRepoAccess?: boolean;
    /** GitHub rejected the stored token; the user must Sign in with GitHub again. */
    expired?: boolean;
  };
  githubAttachProjectIds?: string[];
  integrations: AgentContextIntegration[];
  docs: AgentContextDoc[];
  organizations?: AgentContextOrganization[];
};

export type PersonalPersonaRole = "tech_lead" | "frontend" | "qa" | "pm";
export type PersonalAgentStatus = "draft" | "trained" | "retraining";

export type PersonalTrainingAnswerSource = "user" | "inferred";

export type PersonalTrainingAnswer = {
  questionId: string;
  question: string;
  answer: string;
  source?: PersonalTrainingAnswerSource;
};

export type TrainingProgress = {
  answered: number;
  inferred: number;
  total: number;
  percent: number;
};

export type PersonalTrainingQuestion = {
  id: string;
  prompt: string;
  hint?: string;
  placeholder?: string;
  required?: boolean;
};

export type PersonalAgentVersion = {
  version: number;
  personaRole: PersonalPersonaRole;
  compiledPrompt: string;
  trainedAt: string;
};

export type PersonalAgentProfile = {
  id: string;
  userId: string;
  personaRole: PersonalPersonaRole;
  jobTitle?: string;
  workspaceRole?: string;
  status: PersonalAgentStatus;
  answers: PersonalTrainingAnswer[];
  compiledPrompt: string;
  promptVersion: number;
  history: PersonalAgentVersion[];
  trainedAt?: string;
  updatedAt: string;
};
