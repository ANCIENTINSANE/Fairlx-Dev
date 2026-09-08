import type {
  AgentChatMessage,
  AgentPendingConfirmation,
  AgentPermissionType,
  AgentToolCall,
  AgentToolEvent,
  AgentWriteRisk,
} from "../types";
import { skipCodingLoopConfirmation } from "./auto-mode";

const HARNESS_WRITES = new Set([
  "create_project",
  "mail_send",
  "github_write_file",
  "github_open_pr",
  "github_merge_pr",
  "github_create_repo",
  "github_link_repo",
  "github_update_repo",
  "github_delete_file",
  "github_create_issue",
  "github_close_issue",
  "github_comment_issue",
  "coding_session_start",
  "coding_session_implement",
  "submit_implementation_plan",
]);
const WRITE_NAME_RE = /_(create|update|delete|add|set|start|complete|split|sync|remove|mark_read)$/i;
const PRIVILEGED_NAME_RE =
  /(mail_send|github_write_file|github_open_pr|github_merge_pr|github_create_repo|github_link_repo|github_update_repo|github_delete_file|github_create_issue|github_close_issue|github_comment_issue|coding_session_start|submit_implementation_plan|create_project|project_create|_delete|_remove|member_add|member_invite|workspace_member|organization_update|security_review|notify|doc_create|doc_update)/i;

export function mcpToolNameFromCall(call: AgentToolCall): string | undefined {
  if (call.name !== "mcp_call" && call.name !== "create_project") {
    if (call.name.startsWith("fairlx_")) return call.name;
    return undefined;
  }
  try {
    const parsed = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
    const tool = parsed.tool ?? parsed.name;
    return typeof tool === "string" && tool ? tool : undefined;
  } catch {
    return undefined;
  }
}

export function isWriteToolCall(call: AgentToolCall): boolean {
  if (HARNESS_WRITES.has(call.name)) return true;
  const mcpName = mcpToolNameFromCall(call) ?? (call.name.startsWith("fairlx_") ? call.name : "");
  if (!mcpName) return false;
  return WRITE_NAME_RE.test(mcpName);
}

export function writeRiskLevel(call: AgentToolCall): AgentWriteRisk {
  if (!isWriteToolCall(call)) return "read";
  const mcpName = mcpToolNameFromCall(call) ?? call.name;
  if (HARNESS_WRITES.has(call.name) || PRIVILEGED_NAME_RE.test(mcpName)) return "privileged";
  return "standard";
}

export const DESTRUCTIVE_NOT_REQUESTED_MESSAGE =
  "Refused: this chat did not ask to delete existing records. Existing work is important. Do not delete, replace, or clean up old items — create or update instead. Do not retry this delete.";

export const DESTRUCTIVE_REQUIRES_ACCEPT_MESSAGE =
  "Destructive Fairlx tools cannot run until the user clicks Accept in the Fairlx agent. Do not retry with confirm or a challengeToken.";

const DESTRUCTIVE_NAME_RE = /(_delete|_remove)$/i;
const CONTINUE_ONLY_RE = /^(continue|ok|okay|yes|yep|go ahead|please continue|keep going|proceed)\.?$/i;

export function isDestructiveToolName(name: string): boolean {
  return DESTRUCTIVE_NAME_RE.test(name.trim());
}

export function isDestructiveToolCall(call: AgentToolCall): boolean {
  const mcpName = mcpToolNameFromCall(call) ?? call.name;
  return isDestructiveToolName(mcpName);
}

function clipEvidence(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function isForbiddenDeleteSpeech(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\b(don'?t|do not|never|not to|stop)\b.{0,24}\b(delete|wipe|purge|remove)\b/i.test(lower)) return true;
  return /\b(why did you|why would you|you (already )?deleted|shouldn'?t have deleted|should not have deleted)\b/i.test(
    lower,
  );
}

function isCreateOrPlanWithoutDelete(text: string): boolean {
  if (userRequestedDestructiveDelete(text)) return false;
  return (
    /\b(create|plan|add|build|flesh|detail|spec)\b/i.test(text) &&
    /\b(work items?|epics?|sprints?|stories|project|backlog|product|board)\b/i.test(text)
  );
}

/** True only when this user message itself asks to delete/remove records. */
export function userRequestedDestructiveDelete(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || CONTINUE_ONLY_RE.test(t)) return false;
  if (isForbiddenDeleteSpeech(t)) return false;
  const lower = t.toLowerCase();
  if (/\b(assignee|assignees|assignment|unassign)\b/i.test(lower) && !/\b(delete|wipe|purge)\b/i.test(lower)) {
    return false;
  }
  if (/\b(delete|wipe|purge|permanently remove)\b/i.test(lower)) return true;
  return /\bremove\b.{0,60}\b(work items?|tickets?|epics?|sprints?|projects?|members?|comments?|docs?|documents?|webhooks?|from (the )?(workspace|team|project)|[a-z]{2,10}-\d+)\b/i.test(
    lower,
  );
}

export type ConversationDeleteIntent = {
  allowed: boolean;
  status: "requested" | "not_requested" | "forbidden";
  evidence: string;
};

/** Walk every user message: latest create/plan or objection wins over an older delete ask. */
export function conversationDeleteIntent(userTexts: string[]): ConversationDeleteIntent {
  const substantive = userTexts
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter((text) => text && !CONTINUE_ONLY_RE.test(text));
  if (!substantive.length) {
    return {
      allowed: false,
      status: "not_requested",
      evidence: "No user message asked to delete existing records.",
    };
  }
  const latest = substantive[substantive.length - 1]!;
  if (isForbiddenDeleteSpeech(latest)) {
    return { allowed: false, status: "forbidden", evidence: clipEvidence(latest) };
  }
  if (userRequestedDestructiveDelete(latest)) {
    return { allowed: true, status: "requested", evidence: clipEvidence(latest) };
  }
  if (isCreateOrPlanWithoutDelete(latest)) {
    return { allowed: false, status: "not_requested", evidence: clipEvidence(latest) };
  }
  for (let i = substantive.length - 1; i >= 0; i -= 1) {
    const text = substantive[i]!;
    if (isForbiddenDeleteSpeech(text)) {
      return { allowed: false, status: "forbidden", evidence: clipEvidence(text) };
    }
    if (userRequestedDestructiveDelete(text)) {
      return { allowed: true, status: "requested", evidence: clipEvidence(text) };
    }
  }
  return {
    allowed: false,
    status: "not_requested",
    evidence: "No user message asked to delete existing records.",
  };
}

export function formatDeleteIntentContext(userTexts: string[]): string {
  const intent = conversationDeleteIntent(userTexts);
  if (intent.status === "requested") {
    return [
      "Conversation delete intent: requested.",
      `The user asked to delete: "${intent.evidence}".`,
      "Think twice before each delete. Only remove the records they named.",
      "Skip items that are still important (in progress, assigned, in the active sprint, or already detailed) unless they named those keys.",
      "Prefer update when they wanted more detail, not a wipe.",
    ].join(" ");
  }
  if (intent.status === "forbidden") {
    return [
      "Conversation delete intent: forbidden.",
      `The user objected: "${intent.evidence}".`,
      "Do not delete work items, sprints, projects, docs, or members.",
    ].join(" ");
  }
  return [
    "Conversation delete intent: not requested.",
    "Review the user messages: they asked to create, plan, or update — not to delete existing records.",
    "Existing work items are important. Do not delete them to replace, rename, or flesh them out. Create new items or update the existing ones.",
  ].join(" ");
}

export function destructiveUserAccepted(params: {
  userAccepted?: boolean;
  permissionType?: AgentPermissionType;
  userTexts?: string[];
  latestUserText?: string;
}): boolean {
  if (params.userAccepted) return true;
  if (params.permissionType !== "all_access") return false;
  const texts = params.userTexts?.length ? params.userTexts : [params.latestUserText || ""];
  return conversationDeleteIntent(texts).allowed;
}

export function destructiveToolBlockReason(params: {
  toolName: string;
  userAccepted?: boolean;
  permissionType?: AgentPermissionType;
  userTexts?: string[];
  latestUserText?: string;
}): "not_requested" | "requires_accept" | null {
  if (!isDestructiveToolName(params.toolName)) return null;
  if (params.userAccepted) return null;
  const texts = params.userTexts?.length ? params.userTexts : [params.latestUserText || ""];
  if (!conversationDeleteIntent(texts).allowed) return "not_requested";
  if (params.permissionType === "all_access") return null;
  return "requires_accept";
}

export function needsConfirmation(
  call: AgentToolCall,
  permissionType: AgentPermissionType | undefined,
  options?: { autonomousCoding?: boolean },
): boolean {
  if (permissionType === "all_access") return false;
  if (skipCodingLoopConfirmation(call, Boolean(options?.autonomousCoding))) return false;
  if (isDestructiveToolCall(call)) return true;
  return writeRiskLevel(call) === "privileged";
}

export function callsNeedingConfirmation(
  calls: AgentToolCall[],
  permissionType: AgentPermissionType | undefined,
  options?: { autonomousCoding?: boolean },
): AgentToolCall[] {
  return calls.filter((call) => needsConfirmation(call, permissionType, options));
}

export function confirmationSummary(call: AgentToolCall): string {
  const mcpName = mcpToolNameFromCall(call) ?? call.name;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }
  const nested =
    args.arguments && typeof args.arguments === "object"
      ? (args.arguments as Record<string, unknown>)
      : args;
  const label = String(nested.name || nested.title || nested.key || "").trim();
  const role = String(nested.role || "").trim();
  const action = mcpName
    .replace(/^fairlx_/, "")
    .replaceAll("_", " ")
    .trim();
  if (/doc_create/i.test(mcpName) && label) {
    return `Save project document "${label}"?`;
  }
  if (/doc_update/i.test(mcpName) && label) {
    return `Update project document "${label}"?`;
  }
  if (/work_item_create/i.test(mcpName) && label) {
    const type = String(nested.type || "Task").toLowerCase();
    const formattedType = type.charAt(0).toUpperCase() + type.slice(1);
    const priority = nested.priority ? ` [${String(nested.priority)}]` : "";
    return `Create ${formattedType}: "${label}"${priority}?`;
  }
  if (/project_team_member_add/i.test(mcpName)) {
    const person = String(nested.name || nested.email || "").trim();
    const team = String(nested.teamName || nested.team || "").trim();
    if (person && team) return `Add ${person} to ${team}?`;
    if (person) return `Add ${person} to the team?`;
  }
  if (/project_member_add/i.test(mcpName)) {
    const person = String(nested.name || nested.email || "").trim();
    const team = String(nested.teamName || nested.team || "").trim();
    if (person && team) return `Add ${person} to the project and ${team}?`;
    if (person) return `Add ${person} to the project?`;
  }
  if (/project_team_member_remove/i.test(mcpName)) {
    const person = String(nested.name || nested.email || "").trim();
    const team = String(nested.teamName || nested.team || "").trim();
    if (person && team) return `Remove ${person} from ${team}?`;
    if (person) return `Remove ${person} from the team?`;
  }
  if (/project_team_create/i.test(mcpName) && label) {
    return `Create team "${label}"?`;
  }
  if (call.name === "mail_send" || /mail_send/i.test(mcpName)) {
    const to = String(nested.to || "").trim();
    return to ? `Send mail to ${to}?` : "Send this mail?";
  }
  if (call.name === "github_write_file") {
    const path = String(nested.path || label).trim();
    return path ? `Write ${path} on GitHub?` : "Write a GitHub file?";
  }
  if (call.name === "github_open_pr") {
    return label ? `Open PR: ${label}?` : "Open a GitHub pull request?";
  }
  if (call.name === "github_merge_pr") {
    const number = nested.pullNumber;
    return number ? `Merge pull request #${number}?` : "Merge this pull request?";
  }
  if (call.name === "github_create_repo") {
    const name = String(nested.name || label).trim();
    const owner = String(nested.owner || "").trim();
    const visibility = nested.private === false ? "public" : "private";
    if (name && owner) return `Create ${visibility} GitHub repository ${owner}/${name}?`;
    return name ? `Create ${visibility} GitHub repository ${name}?` : "Create a GitHub repository?";
  }
  if (call.name === "github_update_repo") {
    const owner = String(nested.owner || "").trim();
    const repo = String(nested.repo || nested.repoId || label).trim();
    const makePrivate = nested.private === true || nested.visibility === "private";
    const makePublic = nested.private === false || nested.visibility === "public";
    const target = owner && repo && !repo.includes("/") ? `${owner}/${repo}` : repo || "this repository";
    if (makePrivate) return `Make ${target} private?`;
    if (makePublic) return `Make ${target} public?`;
    return `Update GitHub repository ${target}?`;
  }
  if (call.name === "github_delete_file") {
    const path = String(nested.path || label).trim();
    return path ? `Delete ${path} on GitHub?` : "Delete this GitHub file?";
  }
  if (call.name === "github_create_issue") {
    const title = String(nested.title || label).trim();
    return title ? `Create GitHub issue “${title}”?` : "Create a GitHub issue?";
  }
  if (call.name === "github_close_issue") {
    const number = nested.issueNumber || nested.number;
    return number ? `Close GitHub issue #${number}?` : "Close this GitHub issue?";
  }
  if (call.name === "github_comment_issue") {
    const number = nested.issueNumber || nested.number;
    return number ? `Comment on GitHub issue #${number}?` : "Comment on this GitHub issue?";
  }
  if (/workspace_member_add/i.test(mcpName) && label) {
    return role ? `Add ${label} as ${role}?` : `Add ${label} to the workspace?`;
  }
  if (/workspace_member_remove/i.test(mcpName) && label) {
    return `Remove ${label} from the workspace?`;
  }
  if (/workspace_member_update/i.test(mcpName) && (label || role)) {
    if (label && role) return `Make ${label} ${role}?`;
    if (label) return `Update ${label}'s role?`;
    return `Change member role to ${role}?`;
  }
  if (/delete/i.test(mcpName)) {
    return label ? `Delete ${label}?` : `Delete via ${action}?`;
  }
  if (/update|set|complete|start|sync/i.test(mcpName)) {
    return label ? `Update ${label}?` : `Apply ${action}?`;
  }
  if (call.name === "github_link_repo") {
    const owner = String(nested.owner || "").trim();
    const repo = String(nested.repo || nested.repoId || label).trim();
    if (owner && repo && !repo.includes("/")) return `Attach ${owner}/${repo} to this project?`;
    return repo ? `Attach ${repo} to this project?` : "Attach this GitHub repository to the project?";
  }
  if (call.name === "submit_implementation_plan") {
    const title = String(nested.title || label).trim();
    return title ? `Accept implementation plan: ${title}?` : "Accept this implementation plan?";
  }
  if (call.name === "coding_session_start") {
    const item = String(nested.workItemId || label).trim();
    return item ? `Start a coding session for ${item}?` : "Start an Azure coding session?";
  }
  if (/create|add/i.test(mcpName) || call.name === "create_project") {
    return label ? `Create ${label}?` : `Create via ${action}?`;
  }
  return label ? `Apply ${action} to ${label}?` : `Apply ${action}?`;
}

export type ParsedWorkItemCall = {
  id: string;
  toolName: string;
  projectId?: string;
  title: string;
  type: string;
  priority: string;
  description?: string;
  labels: string[];
  sprintId?: string;
};

export function parseWorkItemCall(call: AgentToolCall): ParsedWorkItemCall | null {
  const mcpName = mcpToolNameFromCall(call) ?? call.name;
  if (!/work_item_create/i.test(mcpName)) return null;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }
  const nested =
    args.arguments && typeof args.arguments === "object"
      ? (args.arguments as Record<string, unknown>)
      : args;
  const title = String(nested.title || nested.name || "").trim();
  if (!title) return null;
  const type = String(nested.type || "TASK").toUpperCase();
  const priority = String(nested.priority || "MEDIUM").toUpperCase();
  const description = typeof nested.description === "string" ? nested.description.trim() : undefined;
  const labels = Array.isArray(nested.labels)
    ? nested.labels.map(String).filter(Boolean)
    : [];
  return {
    id: call.id,
    toolName: mcpName,
    projectId: typeof nested.projectId === "string" ? nested.projectId : undefined,
    title,
    type,
    priority,
    description,
    labels,
    sprintId: typeof nested.sprintId === "string" ? nested.sprintId : undefined,
  };
}

export type ParsedConfirmationCall = {
  id: string;
  call: AgentToolCall;
  toolName: string;
  action: string;
  label: string;
  summary: string;
  workItem?: ParsedWorkItemCall;
};

export function parseConfirmationCall(call: AgentToolCall): ParsedConfirmationCall {
  const mcpName = mcpToolNameFromCall(call) ?? call.name;
  const workItem = parseWorkItemCall(call) ?? undefined;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }
  const nested =
    args.arguments && typeof args.arguments === "object"
      ? (args.arguments as Record<string, unknown>)
      : args;
  const label = String(nested.name || nested.title || nested.key || "").trim();
  const action = mcpName.replace(/^fairlx_/, "").replaceAll("_", " ").trim();
  return {
    id: call.id,
    call,
    toolName: mcpName,
    action,
    label,
    summary: confirmationSummary(call),
    workItem,
  };
}

export function pendingFromEvent(event: AgentToolEvent | undefined): AgentPendingConfirmation | undefined {
  if (!event || event.type !== "confirmation") return undefined;
  const payload = event.payload;
  if (!payload || typeof payload !== "object") return undefined;
  const data = payload as AgentPendingConfirmation;
  if (!Array.isArray(data.calls) || data.calls.length === 0) return undefined;
  return data;
}

export function unmatchedToolCalls(messages: AgentChatMessage[] = []): AgentToolCall[] {
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant" && message.toolCalls?.length);
  if (!lastAssistant?.toolCalls?.length) return [];
  const answered = new Set(
    messages.filter((message) => message.role === "tool" && message.toolCallId).map((message) => message.toolCallId),
  );
  return lastAssistant.toolCalls.filter((call) => !answered.has(call.id));
}

export function findPendingConfirmation(
  events: AgentToolEvent[] = [],
  messages?: AgentChatMessage[],
): AgentPendingConfirmation | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type === "confirmation") {
      const fromEvent = pendingFromEvent(event);
      if (fromEvent) return fromEvent;

      if (messages?.length) {
        const writes = unmatchedToolCalls(messages).filter(isWriteToolCall);
        if (writes.length) {
          return {
            calls: writes,
            summary: event.title || writes.map(confirmationSummary).join(" · "),
          };
        }
      }

      return {
        calls: [],
        summary: event.title || "Pending actions require your approval.",
      };
    }
    if (event.type === "confirmation_resolved") return undefined;
  }

  if (messages?.length) {
    const writes = unmatchedToolCalls(messages).filter(isWriteToolCall);
    if (writes.length) {
      return {
        calls: writes,
        summary: writes.map(confirmationSummary).join(" · "),
      };
    }
  }

  return undefined;
}
