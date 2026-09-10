import type {
  AgentChatMessage,
  AgentSpecialistId,
  AgentToolCall,
  AgentToolEvent,
  ImplementationPlan,
  ImplementationPlanPhase,
  ImplementationPlanTask,
  ImplementationPlanTaskStatus,
} from "../types";
import { truncateAtBoundary } from "./truncate";

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
  plan?: ImplementationPlan | null,
): boolean {
  if (conversationWantsSessionPreview(lastUserText)) return false;
  if (conversationLooksLikeError(lastUserText)) return false;
  if (planAccepted && conversationWantsNewPlanSlice(lastUserText, plan)) return true;
  if (planAccepted) return false;
  return conversationWantsBuildOrChange(intentText);
}

export function runHasAcceptedPlan(run: {
  implementationPlan?: ImplementationPlan | { status?: string; title?: string };
  events?: AgentToolEvent[];
}): boolean {
  if (planStatusFromUnknown(run.implementationPlan) === "accepted") return true;
  if (planIsAccepted(parseImplementationPlan(run.implementationPlan))) return true;
  const events = run.events ?? [];
  if (events.some((event) => event.type === "coding_session_start")) {
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

export type PhaseProgress = {
  id: string;
  index: number;
  title: string;
  done: number;
  total: number;
  complete: boolean;
  remaining: string[];
};

export function planPhaseProgress(plan?: ImplementationPlan | null): PhaseProgress[] {
  const phases = Array.isArray(plan?.phases) ? plan.phases : [];
  return phases.map((phase, index) => {
    const tasks = Array.isArray(phase.tasks) ? phase.tasks : [];
    const done = tasks.filter((task) => task.status === "done").length;
    return {
      id: phase.id,
      index,
      title: phase.title,
      done,
      total: tasks.length,
      complete: tasks.length > 0 && done === tasks.length,
      remaining: tasks.filter((task) => task.status !== "done").map((task) => task.title),
    };
  });
}

export function firstIncompletePhase(plan?: ImplementationPlan | null): PhaseProgress | null {
  return planPhaseProgress(plan).find((phase) => !phase.complete) ?? null;
}

const STOP_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "want",
  "just",
  "please",
  "make",
  "into",
  "your",
  "their",
  "about",
  "some",
  "more",
  "also",
  "then",
  "than",
  "them",
  "they",
  "will",
  "would",
  "could",
  "should",
  "page",
  "site",
  "website",
]);

function significantTokens(text: string): Set<string> {
  return new Set(
    (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
  );
}

const CONTINUE_PLAN_RE =
  /\b(continue|keep going|next phase|finish (the )?(plan|phase)|same plan|phase\s*\d+|carry on)\b/i;
const FOCUSED_SLICE_RE =
  /\b(hamburger|burger menu|nav(igation)? menu|mobile menu|responsive|small devices?|media quer(?:y|ies)|add (a |the )?(button|link|icon|banner|modal|toast|tooltip|footer|header)|tweak|polish|rename|restyle)\b/i;

export function conversationLooksLikeUiFollowUp(text: string): boolean {
  return FOCUSED_SLICE_RE.test(text || "");
}

function normalizePlanTitle(title: string): string {
  return (title || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when two plans are the same piece of work (truncated extraJson vs full event), not a new slice. */
export function plansDescribeSameWork(
  a?: ImplementationPlan | null,
  b?: ImplementationPlan | null,
): boolean {
  if (!a || !b) return false;
  const titleA = normalizePlanTitle(a.title);
  const titleB = normalizePlanTitle(b.title);
  if (titleA && titleB && (titleA === titleB || titleA.startsWith(titleB) || titleB.startsWith(titleA))) return true;
  const idA = a.phases[0]?.id;
  const idB = b.phases[0]?.id;
  return Boolean(idA && idB && idA === idB);
}

export function followUpImplementPrompt(userText: string, plan?: ImplementationPlan | null): string {
  const slice = conversationWantsNewPlanSlice(userText, plan);
  const phase = slice ? null : firstIncompletePhase(plan);
  const mobile = conversationLooksLikeUiFollowUp(userText);
  return [
    `The user asked: ${userText.trim() || "Apply the current implementation plan."}`,
    "Edit the EXISTING app in /workspace. Do not scaffold a new product and do not rebuild pages that already work.",
    "Make the change so it is visible in the running Vite/dev-server preview (hot reload). Save files under /workspace.",
    phase ? `Stay on this phase: ${phase.title}. Remaining: ${phase.remaining.join("; ") || "(none)"}` : "",
    mobile
      ? "Add a real mobile hamburger/drawer (button + panel/nav), not comments. It must show at a phone width (~390px) and the layout must reflow (responsive). Do not leave the desktop-only header unchanged."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Prompt for the first `coding_session_implement` right after a fresh sandbox start. Used to chain
 * start → implement inside one turn instead of paying another orchestrator round-trip.
 */
export function phaseImplementPrompt(plan: ImplementationPlan | null | undefined, userText: string): string {
  const phase = firstIncompletePhase(plan);
  return [
    plan ? `Implementation plan: ${plan.title}${plan.summary ? ` — ${plan.summary}` : ""}` : "",
    phase
      ? `Implement this phase now: ${phase.title}. Tasks: ${phase.remaining.join("; ") || "(see plan)"}. Finish the whole phase before stopping.`
      : `The user asked: ${userText.trim() || "Implement the accepted plan."}`,
    "Work in /workspace where the dev server is already running; save files so the preview hot-reloads.",
    "If /workspace is empty, scaffold the app in place (no nested folder) so the dev server on the exposed port serves it.",
    "Do not ask questions; make reasonable choices and report what you changed.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** True when the leftover plan tasks already cover this prompt (continue the plan). */
export function planCoversPrompt(plan: ImplementationPlan | null | undefined, text: string): boolean {
  if (!plan) return false;
  const promptTokens = significantTokens(text);
  if (promptTokens.size === 0) return true;
  const remaining = plan.phases
    .flatMap((phase) => (Array.isArray(phase.tasks) ? phase.tasks : []))
    .filter((task) => task.status !== "done")
    .map((task) => task.title)
    .join(" ");
  const haystack = significantTokens(`${plan.title} ${plan.summary} ${remaining}`);
  let hits = 0;
  for (const token of promptTokens) {
    if (haystack.has(token)) hits += 1;
  }
  return hits >= Math.min(2, promptTokens.size);
}

/**
 * Latest message is a new focused change (hamburger menu, a one-file tweak) that should not
 * execute leftover phases of a large accepted plan.
 */
export function conversationWantsNewPlanSlice(text: string, plan?: ImplementationPlan | null): boolean {
  if (!plan || !planIsAccepted(plan)) return false;
  if (CONTINUE_PLAN_RE.test(text || "")) return false;
  if (conversationLooksLikeError(text)) return false;
  if (conversationWantsSessionPreview(text)) return false;
  const incomplete = firstIncompletePhase(plan);
  if (!incomplete) return Boolean((text || "").trim());
  if (FOCUSED_SLICE_RE.test(text || "")) return !planCoversPrompt(plan, text);
  if (planCoversPrompt(plan, text)) return false;
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  return words > 0 && words <= 24;
}

export function currentPhaseDirective(plan?: ImplementationPlan | null): string {
  const phase = firstIncompletePhase(plan);
  if (!phase) {
    return "The accepted plan is complete. If the user asked for more work, call submit_implementation_plan with a short plan for that request.";
  }
  const left = phase.remaining.map((title) => `- ${title}`).join("\n");
  const heavy =
    phase.total >= 3 ||
    phase.remaining.some((title) => /architect|full |entire |across|foundation|responsive/i.test(title));
  return [
    `Current phase to finish this turn: Phase ${phase.index + 1} — ${phase.title} (${phase.done}/${phase.total}).`,
    `Remaining in this phase:\n${left || "- (none)"}`,
    heavy
      ? "This phase is large. If you cannot finish every remaining task this turn, tell the user in chat: what you completed, what is still open, and that the next turn continues this phase. Do not start a later phase."
      : "Complete every remaining task in this phase before starting a later phase.",
    "Never skip ahead to a later phase while this one still has open tasks.",
  ].join("\n");
}

export function describePlanSituation(plan: ImplementationPlan | null | undefined, text: string): string | null {
  if (!plan || !planIsAccepted(plan)) return null;
  const { percent, done, total } = planCompletion(plan);
  const phase = firstIncompletePhase(plan);
  if (conversationWantsNewPlanSlice(text, plan)) {
    return `The accepted plan "${plan.title}" is ${percent}% done (${done}/${total}). This message is a new focused change — submit a short implementation plan for it. Do not execute leftover phases of the old plan.`;
  }
  if (!phase) return `The accepted plan "${plan.title}" is complete.`;
  return `Stay on Phase ${phase.index + 1} (${phase.title}): ${phase.done}/${phase.total} tasks done. Finish this phase (or tell the user what is left) before later phases.`;
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

const NEW_SLICE_BLOCK_MESSAGE =
  "This message is a new focused change, not leftover phases of the accepted plan. Call submit_implementation_plan with a short plan for THIS request (one phase is enough). Do not implement leftover phases from the old plan.";

export function buildGateBlockMessage(lastUserText: string, plan?: ImplementationPlan | null): string {
  return conversationWantsNewPlanSlice(lastUserText, plan) ? NEW_SLICE_BLOCK_MESSAGE : BUILD_GATE_BLOCK_MESSAGE;
}

export function blockedBuildGateResult(call: AgentToolCall, message = BUILD_GATE_BLOCK_MESSAGE): string {
  return JSON.stringify({
    error: message,
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
  const incompleteIndex = phases.findIndex((phase) =>
    (Array.isArray(phase.tasks) ? phase.tasks : []).some((task) => task.status !== "done"),
  );
  if (incompleteIndex < 0) return plan;
  let found = false;
  const nextPhases = phases.map((phase, index) => {
    if (index !== incompleteIndex) return phase;
    return {
      ...phase,
      tasks: (Array.isArray(phase.tasks) ? phase.tasks : []).map((task) => {
        if (found || task.status === "done") return task;
        if (!matchTask(task, pattern)) return task;
        found = true;
        return { ...task, status: "done" as const };
      }),
    };
  });
  return found ? { ...plan, phases: nextPhases } : plan;
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

type PlanClampLimits = {
  title: number;
  summary: number;
  phases: number;
  phaseTitle: number;
  tasks: number;
  taskTitle: number;
  id: number;
};

/** Fits `agent_runs.extraJson` (16KB) without slicing titles mid-word. */
const PLAN_STORE_LIMITS: PlanClampLimits = {
  title: 200,
  summary: 480,
  phases: 8,
  phaseTitle: 180,
  tasks: 8,
  taskTitle: 180,
  id: 48,
};

/** Events JSON is 1MB — keep the readable plan, only clamp runaway payloads. */
const PLAN_EVENT_LIMITS: PlanClampLimits = {
  title: 400,
  summary: 2000,
  phases: 16,
  phaseTitle: 400,
  tasks: 16,
  taskTitle: 400,
  id: 64,
};

function clampPlan(plan: ImplementationPlan, limits: PlanClampLimits): ImplementationPlan {
  const phases = Array.isArray(plan.phases) ? plan.phases : [];
  return {
    title: truncateAtBoundary(String(plan.title || "Implementation plan"), limits.title),
    summary: truncateAtBoundary(String(plan.summary || ""), limits.summary),
    status: plan.status,
    phases: phases.slice(0, limits.phases).map((phase) => ({
      id: String(phase.id || "").slice(0, limits.id),
      title: truncateAtBoundary(String(phase.title || ""), limits.phaseTitle),
      tasks: (Array.isArray(phase.tasks) ? phase.tasks : []).slice(0, limits.tasks).map((task) => ({
        id: String(task.id || "").slice(0, limits.id),
        title: truncateAtBoundary(String(task.title || ""), limits.taskTitle),
        status: task.status,
        ...(task.specialist ? { specialist: task.specialist } : {}),
      })),
    })),
    ...(plan.repo ? { repo: plan.repo } : {}),
    ...(plan.execution ? { execution: plan.execution } : {}),
  };
}

export function compactImplementationPlan(plan: ImplementationPlan): ImplementationPlan {
  return clampPlan(plan, PLAN_STORE_LIMITS);
}

export function persistImplementationPlan(plan: ImplementationPlan): ImplementationPlan {
  return clampPlan(plan, PLAN_EVENT_LIMITS);
}

function planContentLength(plan: ImplementationPlan): number {
  return (
    (plan.summary || "").length +
    plan.phases.reduce(
      (sum, phase) =>
        sum + phase.title.length + phase.tasks.reduce((inner, task) => inner + task.title.length, 0),
      0,
    )
  );
}

export function mergeImplementationPlans(
  fuller: ImplementationPlan,
  overlay: ImplementationPlan,
): ImplementationPlan {
  const overlayById = new Map<string, ImplementationPlanTask>();
  for (const phase of overlay.phases) {
    for (const task of phase.tasks) overlayById.set(task.id, task);
  }
  const status =
    overlay.status === "accepted" || overlay.status === "rejected" ? overlay.status : fuller.status;
  return {
    ...fuller,
    status,
    repo: overlay.repo ?? fuller.repo,
    execution: overlay.execution ?? fuller.execution,
    phases: fuller.phases.map((phase, phaseIndex) => ({
      ...phase,
      tasks: phase.tasks.map((task, taskIndex) => {
        const match = overlayById.get(task.id) ?? overlay.phases[phaseIndex]?.tasks[taskIndex];
        return match ? { ...task, status: match.status, specialist: task.specialist || match.specialist } : task;
      }),
    })),
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

export function implementationPlanFromMessages(messages: AgentChatMessage[] = []): ImplementationPlan | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      const calls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
      for (let callIndex = calls.length - 1; callIndex >= 0; callIndex -= 1) {
        const call = calls[callIndex];
        if (call?.name !== "submit_implementation_plan") continue;
        try {
          const parsed = parseImplementationPlan(JSON.parse(call.arguments || "{}"));
          if (parsed) return parsed;
        } catch {
          continue;
        }
      }
    }
    if (message?.role === "tool" && message.toolName === "submit_implementation_plan") {
      try {
        const parsed = parseImplementationPlan(JSON.parse(message.content || "{}"));
        if (parsed) return parsed;
      } catch {
        continue;
      }
    }
  }
  return null;
}

function pickFullestPlan(...plans: Array<ImplementationPlan | null | undefined>): ImplementationPlan | null {
  let best: ImplementationPlan | null = null;
  let bestLen = -1;
  for (const plan of plans) {
    if (!plan) continue;
    const length = planContentLength(plan);
    if (length > bestLen) {
      best = plan;
      bestLen = length;
    }
  }
  return best;
}

export function resolveRunImplementationPlan(run: {
  implementationPlan?: ImplementationPlan;
  events?: AgentToolEvent[];
  messages?: AgentChatMessage[];
}): ImplementationPlan | null {
  const extraStatus = planStatusFromUnknown(run.implementationPlan);
  const fromStored = parseImplementationPlan(run.implementationPlan);
  const fromEvents = implementationPlanFromEvents(run.events ?? []);
  const fromMessages = implementationPlanFromMessages(run.messages ?? []);
  // Latest submit wins. Do not merge a new hamburger/responsive slice into an older leftover
  // mega-plan just because the old plan has more text.
  const latest = fromEvents ?? fromMessages ?? fromStored;
  if (!latest) return planAcceptanceStub(run.implementationPlan);
  const sameWork = [fromStored, fromEvents, fromMessages].filter(
    (plan): plan is ImplementationPlan => Boolean(plan && plansDescribeSameWork(plan, latest)),
  );
  const fullestSame = pickFullestPlan(...sameWork) ?? latest;
  let plan = mergeImplementationPlans(fullestSame, latest);
  if (fromStored && plansDescribeSameWork(fromStored, latest)) {
    plan = mergeImplementationPlans(plan, fromStored);
  }
  if (extraStatus === "accepted" || extraStatus === "rejected") {
    const storedIdentity = fromStored ?? planAcceptanceStub(run.implementationPlan);
    if (storedIdentity && plansDescribeSameWork(storedIdentity, latest)) {
      return { ...plan, status: extraStatus };
    }
    return plan;
  }
  return plan;
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
