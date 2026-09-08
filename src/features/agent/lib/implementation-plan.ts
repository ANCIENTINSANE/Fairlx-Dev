import type {
  AgentSpecialistId,
  AgentToolCall,
  AgentToolEvent,
  ImplementationPlan,
  ImplementationPlanPhase,
  ImplementationPlanTask,
  ImplementationPlanTaskStatus,
} from "../types";

export type {
  ImplementationPlan,
  ImplementationPlanPhase,
  ImplementationPlanTask,
  ImplementationPlanTaskStatus,
};

const BUILD_OR_CHANGE_RE =
  /\b(start building|build the project|build this|rebuild|from scratch|implement|scaffold|coding sessions?|make changes? in (the )?project|edit the code|ship (this|the|it)|fix .{0,60} in (the )?(repo|codebase|project)|how (do you|to) start|where to start)\b/i;

const INSPECT_RE =
  /\b(what is this|tell me about|describe (this|the) (project|repo|repository)|what does this (project|repo)|explain this (project|repo)|read( the)? readme)\b/i;

const SESSION_PREVIEW_RE =
  /\b(preview( urls?| links?)?|azure preview|azure sandbox|use azure|sandbox preview|coding sessions?( preview| status)?|session status|queued (coding )?session)\b/i;

/** Compiler/runtime dumps the user pasted — not a product spec or “make a website” prompt. */
export function conversationLooksLikeError(text: string): boolean {
  const t = text || "";
  if (/##\s*Error (Type|Message)\b/i.test(t)) return true;
  if (/\bBuild Error\b/.test(t) && /\b(Error Message|Build Output|Unexpected token)\b/.test(t)) return true;
  if (/\bFailed to compile\b/i.test(t)) return true;
  if (/\bUnhandled Runtime Error\b/i.test(t)) return true;
  if (/\bHydration failed\b/i.test(t)) return true;
  if (/\b(TypeError|ReferenceError|SyntaxError|RangeError):\s/.test(t)) return true;
  if (/\bTS\d{4,5}:/.test(t) && /\.\w?tsx?/.test(t)) return true;
  if (/^\s*Error:\s/m.test(t) && (/\bat\s+\S+\s+\(/.test(t) || /╭─\[/.test(t))) return true;
  if (/Unexpected token/.test(t) && (/Did you mean/.test(t) || /╭─\[/.test(t))) return true;
  if (/\bAADSTS\d{5,6}\b/.test(t)) return true;
  return false;
}

const BUILD_INSPECT_TOOLS = new Set([
  "github_list_files",
  "github_read_file",
  "github_list_repos",
  "github_account_status",
  "github_list_owners",
  "github_list_prs",
  "github_list_branches",
  "github_list_issues",
  "github_list_releases",
  "git_status",
  "search_harness",
  "persist_memory",
  "request_capability",
  "fairlx_project_get",
  "fairlx_project_list",
  "fairlx_sprint_list",
  "fairlx_sprint_get",
  "fairlx_work_item_list",
  "fairlx_work_item_get",
  "fairlx_coding_session_status",
  "code_inspect",
  "web_search",
  "web_fetch",
  "submit_implementation_plan",
  "ask_user",
  "mcp_list",
  "mcp_resources",
  "coding_session_status",
  "agent_job_status",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function slugId(prefix: string, index: number, raw?: string): string {
  const base = (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || `${prefix}-${index + 1}`;
}

export function conversationWantsBuildOrChange(text: string): boolean {
  if (conversationLooksLikeError(text)) return false;
  return BUILD_OR_CHANGE_RE.test(text || "");
}

export function conversationWantsSessionPreview(text: string): boolean {
  return SESSION_PREVIEW_RE.test(text || "");
}

export function conversationLooksLikeInspect(text: string): boolean {
  return INSPECT_RE.test(text || "");
}

export function shouldUseInspectModel(text: string, planAccepted: boolean): boolean {
  if (conversationLooksLikeInspect(text)) return true;
  if (conversationLooksLikeError(text)) return true;
  return conversationWantsBuildOrChange(text) && !planAccepted;
}

export function planIsAccepted(plan?: ImplementationPlan | null): boolean {
  return plan?.status === "accepted";
}

export function planStatusFromUnknown(raw: unknown): ImplementationPlan["status"] | null {
  const record = asRecord(raw);
  if (!record) return null;
  const status = String(record.status || "");
  if (status === "accepted" || status === "rejected" || status === "draft") return status;
  return null;
}

/** Keep Accept even when extraJson had to drop phases. */
export function planAcceptanceStub(raw: unknown): ImplementationPlan | null {
  const status = planStatusFromUnknown(raw);
  if (status !== "accepted" && status !== "rejected") return null;
  const title = String(asRecord(raw)?.title || "").trim() || "Implementation plan";
  return { title, summary: "", status, phases: [] };
}

export function buildGateShouldBlock(
  intentText: string,
  lastUserText: string,
  planAccepted: boolean,
): boolean {
  if (planAccepted) return false;
  if (conversationWantsSessionPreview(lastUserText)) return false;
  if (conversationLooksLikeError(lastUserText)) return false;
  return conversationWantsBuildOrChange(intentText);
}

export function runHasAcceptedPlan(run: {
  implementationPlan?: ImplementationPlan | { status?: string; title?: string };
  events?: AgentToolEvent[];
}): boolean {
  if (planStatusFromUnknown(run.implementationPlan) === "accepted") return true;
  if (planIsAccepted(parseImplementationPlan(run.implementationPlan))) return true;
  const events = run.events ?? [];
  if (events.some((event) => event.type === "coding_session_start" && event.type !== "error")) {
    const start = [...events].reverse().find((event) => event.type === "coding_session_start");
    if (start && !asRecord(start.payload)?.error) return true;
  }
  const fromEvents = implementationPlanFromEvents(events);
  if (planIsAccepted(fromEvents)) return true;
  if (events.some((event) => event.type === "submit_implementation_plan" && planStatusFromUnknown(event.payload) === "accepted")) {
    return true;
  }
  const resolved = [...events].reverse().find((event) => event.type === "confirmation_resolved");
  if (resolved?.title === "Accepted") {
    const hadPlan =
      events.some((event) => event.type === "submit_implementation_plan") ||
      events.some((event) => event.type === "confirmation" && /implementation plan/i.test(event.title || ""));
    if (hadPlan) return true;
  }
  return false;
}

export function parseImplementationPlan(raw: unknown): ImplementationPlan | null {
  const record = asRecord(raw);
  if (!record) return null;
  const title = String(record.title || "").trim();
  if (!title) return null;
  const phasesIn = Array.isArray(record.phases) ? record.phases : [];
  const phases: ImplementationPlanPhase[] = phasesIn.flatMap((entry, phaseIndex) => {
    const phase = asRecord(entry);
    if (!phase) return [];
    const phaseTitle = String(phase.title || "").trim();
    if (!phaseTitle) return [];
    const tasksIn = Array.isArray(phase.tasks) ? phase.tasks : [];
    const tasks: ImplementationPlanTask[] = tasksIn.flatMap((taskEntry, taskIndex) => {
      const task = asRecord(taskEntry);
      if (!task) return [];
      const taskTitle = String(task.title || "").trim();
      if (!taskTitle) return [];
      const statusRaw = String(task.status || "pending");
      const status: ImplementationPlanTaskStatus =
        statusRaw === "done" || statusRaw === "in_progress" || statusRaw === "blocked" ? statusRaw : "pending";
      const specialist = String(task.specialist || "").trim() as AgentSpecialistId | "";
      return [
        {
          id: String(task.id || slugId("task", taskIndex, taskTitle)),
          title: taskTitle,
          status,
          ...(specialist ? { specialist } : {}),
        },
      ];
    });
    if (!tasks.length) return [];
    return [
      {
        id: String(phase.id || slugId("phase", phaseIndex, phaseTitle)),
        title: phaseTitle,
        tasks,
      },
    ];
  });
  if (!phases.length) return null;
  const repo = asRecord(record.repo);
  const execution = asRecord(record.execution);
  const statusRaw = String(record.status || "draft");
  return {
    title,
    summary: String(record.summary || "").trim(),
    status: statusRaw === "accepted" || statusRaw === "rejected" ? statusRaw : "draft",
    phases,
    ...(repo
      ? {
          repo: {
            owner: typeof repo.owner === "string" ? repo.owner : undefined,
            name: typeof repo.name === "string" ? repo.name : undefined,
            exists: typeof repo.exists === "boolean" ? repo.exists : undefined,
          },
        }
      : {}),
    ...(execution
      ? {
          execution: {
            codingSession: execution.codingSession !== false,
            exposePort: typeof execution.exposePort === "number" ? execution.exposePort : 3000,
            workItemId: typeof execution.workItemId === "string" ? execution.workItemId : undefined,
          },
        }
      : { execution: { codingSession: true, exposePort: 3000 } }),
  };
}

export function planCompletion(plan?: ImplementationPlan | null): { done: number; total: number; percent: number } {
  const phases = Array.isArray(plan?.phases) ? plan.phases : [];
  const tasks = phases.flatMap((phase) => (Array.isArray(phase?.tasks) ? phase.tasks : []));
  const total = tasks.length;
  const done = tasks.filter((task) => task.status === "done").length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

export function implementationPlanMarkdown(plan: ImplementationPlan): string {
  const parsed = parseImplementationPlan(plan) ?? {
    ...plan,
    title: String(plan?.title || "Implementation plan").trim() || "Implementation plan",
    summary: String(plan?.summary || "").trim(),
    status: plan?.status === "accepted" || plan?.status === "rejected" ? plan.status : "draft",
    phases: [],
  };
  const { percent, done, total } = planCompletion(parsed);
  const lines = [
    `# ${parsed.title}`,
    "",
    parsed.summary ? `${parsed.summary}` : "",
    parsed.summary ? "" : "",
    `Progress: **${percent}%** (${done}/${total} tasks) · ${parsed.status}`,
    "",
  ].filter((line, index, list) => line !== "" || list[index - 1] !== "");
  for (const [index, phase] of parsed.phases.entries()) {
    const tasks = Array.isArray(phase.tasks) ? phase.tasks : [];
    const phaseDone = tasks.filter((task) => task.status === "done").length;
    lines.push(`## Phase ${index + 1}. ${phase.title}`);
    lines.push("");
    lines.push(`${phaseDone}/${tasks.length} complete`);
    lines.push("");
    for (const task of tasks) {
      const box = task.status === "done" ? "[x]" : task.status === "blocked" ? "[!]" : "[ ]";
      const specialist = task.specialist ? ` (${task.specialist})` : "";
      lines.push(`- ${box} ${task.title}${specialist}`);
    }
    lines.push("");
  }
  if (parsed.repo?.owner && parsed.repo.name) {
    lines.push(`Repository: \`${parsed.repo.owner}/${parsed.repo.name}\`${parsed.repo.exists === false ? " (not attached yet)" : ""}`);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

function parseAgentFromCall(call: AgentToolCall): string {
  try {
    const parsed = JSON.parse(call.arguments || "{}") as { agent?: string };
    return String(parsed.agent || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function parseInnerTool(call: AgentToolCall): string {
  if (call.name !== "mcp_call") return call.name;
  try {
    const parsed = JSON.parse(call.arguments || "{}") as { tool?: string };
    return String(parsed.tool || "mcp_call").trim() || "mcp_call";
  } catch {
    return "mcp_call";
  }
}

function isInspectToolName(name: string): boolean {
  if (BUILD_INSPECT_TOOLS.has(name)) return true;
  if (name.startsWith("fairlx_") && /_(list|get|status)$/.test(name)) return true;
  return /_status$/.test(name);
}

export function filterCallsForBuildGate(calls: AgentToolCall[]): {
  allowed: AgentToolCall[];
  blocked: AgentToolCall[];
} {
  const allowed: AgentToolCall[] = [];
  const blocked: AgentToolCall[] = [];
  let plannerDelegated = false;
  for (const call of calls) {
    if (call.name === "delegate_agent") {
      const agent = parseAgentFromCall(call);
      if (agent === "planner" && !plannerDelegated) {
        allowed.push(call);
        plannerDelegated = true;
      } else {
        blocked.push(call);
      }
      continue;
    }
    const inner = parseInnerTool(call);
    if (isInspectToolName(inner) || isInspectToolName(call.name)) {
      allowed.push(call);
      continue;
    }
    blocked.push(call);
  }
  return { allowed, blocked };
}

const SANDBOX_WRITE_TOOLS = new Set([
  "github_write_file",
  "github_delete_file",
  "github_open_pr",
  "coding_session_exec",
  "coding_session_implement",
  "coding_session_browser",
]);

export function runIsWaitingForSandbox(run: { events?: AgentToolEvent[] }): boolean {
  const events = run.events ?? [];
  const start = [...events].reverse().find((event) => event.type === "coding_session_start");
  if (!start) return false;
  const payload = asRecord(start.payload);
  if (!payload || payload.error) return false;
  if (payload.sandboxId) return false;
  return Boolean(payload.jobId);
}

export function filterCallsUntilSandbox(calls: AgentToolCall[]): {
  allowed: AgentToolCall[];
  blocked: AgentToolCall[];
} {
  const allowed: AgentToolCall[] = [];
  const blocked: AgentToolCall[] = [];
  for (const call of calls) {
    if (call.name === "delegate_agent") {
      blocked.push(call);
      continue;
    }
    const inner = parseInnerTool(call);
    if (SANDBOX_WRITE_TOOLS.has(call.name) || SANDBOX_WRITE_TOOLS.has(inner)) {
      blocked.push(call);
      continue;
    }
    if (isInspectToolName(inner) || isInspectToolName(call.name) || call.name === "coding_session_start") {
      allowed.push(call);
      continue;
    }
    blocked.push(call);
  }
  return { allowed, blocked };
}

const BUILD_GATE_BLOCK_MESSAGE =
  "Build loop: submit an implementation plan and wait for Accept before specialists, GitHub writes, PRs, or a coding session. Call submit_implementation_plan.";

export function blockedBuildGateResult(call: AgentToolCall): string {
  return JSON.stringify({
    error: BUILD_GATE_BLOCK_MESSAGE,
    blocked: true,
    tool: call.name,
  });
}

const ERROR_DUMP_BLOCKED_TOOLS = new Set([
  "submit_implementation_plan",
  "coding_session_start",
  "github_create_repo",
  "github_open_pr",
  "fairlx_work_item_create",
  "fairlx_project_create",
  "fairlx_sprint_create",
  "fairlx_sprint_plan",
  "fairlx_doc_create",
  "delegate_agent",
]);

const ERROR_DUMP_BLOCK_MESSAGE =
  "That message is a compiler/runtime error, not a product spec. Do not start a website, implementation plan, repo, or new work item. Read the cited file and fix that error. If Fairlx already created a work item from the error, treat it as a BUG.";

export function filterCallsForErrorDump(calls: AgentToolCall[]): {
  allowed: AgentToolCall[];
  blocked: AgentToolCall[];
} {
  const allowed: AgentToolCall[] = [];
  const blocked: AgentToolCall[] = [];
  for (const call of calls) {
    const inner = parseInnerTool(call);
    if (ERROR_DUMP_BLOCKED_TOOLS.has(call.name) || ERROR_DUMP_BLOCKED_TOOLS.has(inner)) {
      blocked.push(call);
      continue;
    }
    allowed.push(call);
  }
  return { allowed, blocked };
}

export function blockedErrorDumpResult(call: AgentToolCall): string {
  return JSON.stringify({
    error: ERROR_DUMP_BLOCK_MESSAGE,
    blocked: true,
    tool: call.name,
    reason: "pasted_error",
  });
}

const SANDBOX_WAIT_MESSAGE =
  "The coding session sandbox is still preparing. Call coding_session_status or agent_job_status and wait for sandboxId/previewUrl before specialists, GitHub writes, or a PR.";

export function blockedSandboxWaitResult(call: AgentToolCall): string {
  return JSON.stringify({
    error: SANDBOX_WAIT_MESSAGE,
    blocked: true,
    tool: call.name,
    waitingFor: "sandbox",
  });
}

export function isBlockedToolContent(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { blocked?: unknown };
    return parsed?.blocked === true;
  } catch {
    return false;
  }
}

function matchTask(task: ImplementationPlanTask, pattern: RegExp): boolean {
  return pattern.test(task.title);
}

function markFirstMatching(plan: ImplementationPlan, pattern: RegExp): ImplementationPlan {
  const phases = Array.isArray(plan.phases) ? plan.phases : [];
  if (!phases.length) return plan;
  let found = false;
  const nextPhases = phases.map((phase) => ({
    ...phase,
    tasks: (Array.isArray(phase.tasks) ? phase.tasks : []).map((task) => {
      if (found || task.status === "done") return task;
      if (!matchTask(task, pattern)) return task;
      found = true;
      return { ...task, status: "done" as const };
    }),
  }));
  if (found) return { ...plan, phases: nextPhases };
  let marked = false;
  return {
    ...plan,
    phases: phases.map((phase) => ({
      ...phase,
      tasks: (Array.isArray(phase.tasks) ? phase.tasks : []).map((task) => {
        if (marked || task.status === "done") return task;
        marked = true;
        return { ...task, status: "done" as const };
      }),
    })),
  };
}

export function applyPlanProgressFromTool(plan: ImplementationPlan, toolName: string): ImplementationPlan {
  if (plan.status !== "accepted") return plan;
  if (toolName === "coding_session_start") {
    return markFirstMatching(plan, /clone|session|sandbox|azure/i);
  }
  if (toolName === "coding_session_implement") {
    return markFirstMatching(plan, /implement|file|write|scaffold|cli/i);
  }
  if (toolName === "coding_session_browser") {
    return markFirstMatching(plan, /preview|browser|screenshot/i);
  }
  if (toolName === "github_open_pr") {
    return markFirstMatching(plan, /pull request|\bpr\b|open pr/i);
  }
  if (toolName === "github_write_file" || toolName === "github_delete_file") {
    return markFirstMatching(plan, /file|write|scaffold|cli|implement/i);
  }
  if (toolName === "github_create_repo" || toolName === "github_link_repo") {
    return markFirstMatching(plan, /repo|repository|attach|create/i);
  }
  return plan;
}

export function applyPlanProgressFromEvents(plan: ImplementationPlan, events: AgentToolEvent[]): ImplementationPlan {
  let next = plan;
  for (const event of events) {
    if (event.type === "error") continue;
    next = applyPlanProgressFromTool(next, event.type);
  }
  return next;
}

export function compactImplementationPlan(plan: ImplementationPlan): ImplementationPlan {
  const phases = Array.isArray(plan.phases) ? plan.phases : [];
  return {
    title: String(plan.title || "Implementation plan").slice(0, 80),
    summary: String(plan.summary || "").slice(0, 160),
    status: plan.status,
    phases: phases.slice(0, 5).map((phase) => ({
      id: String(phase.id || "").slice(0, 32),
      title: String(phase.title || "").slice(0, 60),
      tasks: (Array.isArray(phase.tasks) ? phase.tasks : []).slice(0, 6).map((task) => ({
        id: String(task.id || "").slice(0, 32),
        title: String(task.title || "").slice(0, 60),
        status: task.status,
        ...(task.specialist ? { specialist: task.specialist } : {}),
      })),
    })),
    ...(plan.repo ? { repo: plan.repo } : {}),
    ...(plan.execution ? { execution: plan.execution } : {}),
  };
}

export function implementationPlanFromEvents(events: AgentToolEvent[]): ImplementationPlan | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "submit_implementation_plan") continue;
    const parsed = parseImplementationPlan(event.payload) ?? planAcceptanceStub(event.payload);
    if (parsed) return parsed;
  }
  return null;
}

export function resolveRunImplementationPlan(run: {
  implementationPlan?: ImplementationPlan;
  events?: AgentToolEvent[];
}): ImplementationPlan | null {
  const extraStatus = planStatusFromUnknown(run.implementationPlan);
  const fromStored = parseImplementationPlan(run.implementationPlan);
  const fromEvents = implementationPlanFromEvents(run.events ?? []);
  const plan = fromStored ?? fromEvents;
  if (plan) {
    if (extraStatus === "accepted" || extraStatus === "rejected") return { ...plan, status: extraStatus };
    return plan;
  }
  return planAcceptanceStub(run.implementationPlan);
}

export function planPanelModel(plan?: ImplementationPlan | null): {
  markdown: string;
  percent: number;
  title: string;
  status: ImplementationPlan["status"];
} | null {
  const parsed = parseImplementationPlan(plan);
  if (!parsed) return null;
  const { percent } = planCompletion(parsed);
  return {
    markdown: implementationPlanMarkdown(parsed),
    percent,
    title: parsed.title,
    status: parsed.status,
  };
}

export function codingSessionArgsFromPlan(
  plan: ImplementationPlan,
  fallbackWorkItemId?: string,
): { workItemId: string; exposePort: number } | null {
  if (plan.execution?.codingSession === false) return null;
  return {
    workItemId: plan.execution?.workItemId || fallbackWorkItemId || "impl",
    exposePort: plan.execution?.exposePort && plan.execution.exposePort > 0 ? plan.execution.exposePort : 3000,
  };
}
