import type { AgentContext, AgentHarness, AgentRun, AgentSpecialistId, McpConfig, PersonalTrainingAnswer } from "../types";
import { compilePersonaPrompt, inferPersonaRole } from "@fairlx/multi-agent";
import { AGENT_DEFINITIONS } from "./brain";
import { AGENT_SPECIALISTS, specialistById } from "./graph";
import { extractAttachedFiles, subjectsFromFiles, subjectsToc, stripAttachedFiles } from "./attachments";
import { matchingAutomations, rankKnowledge } from "./search";
import { isPersonalSessionMode, SESSION_MODE_INSTRUCTIONS } from "./session-context";
import { firstName } from "./agent-ui";
import { PROJECT_DOC_MARKDOWN_GUIDE, documentationPackInstructions } from "@fairlx/mcp-server/markdown";
import { formatProjectGithubLine, hasGithubAccount, hasProjectGithubRepo } from "./github-scope";
import {
  buildTrainingInterviewPrompt,
  formatTrainingSnapshot,
  isTrainingRun,
  suggestedPersonaRole,
} from "./personal-training";
import { SYSTEM_PROMPT_RULE_LINES } from "./prompt-budget";
import { formatDeleteIntentContext } from "./write-guard";
import { implementationPlanMarkdown, planIsAccepted, resolveRunImplementationPlan } from "./implementation-plan";
import { conversationWantsAzureSandbox, runHasNonRetryableSandboxAuth } from "./sandbox/azure";

export { SYSTEM_PROMPT_RULE_LINES, splitSystemPromptBudget } from "./prompt-budget";

export function userInstructionBrief(
  messages: Array<{ role: string; content: string }>,
  maxChars = 2800,
): string {
  const texts = messages
    .filter((message) => message.role === "user")
    .map((message) => stripAttachedFiles(message.content).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!texts.length) return "";
  const numbered = texts.map((text, index) => {
    const clipped = text.length > 700 ? `${text.slice(0, 700)}…` : text;
    return `${index + 1}. ${clipped}`;
  });
  const joined = numbered.join("\n");
  if (joined.length <= maxChars) return joined;
  const first = numbered[0] ?? "";
  const rest = numbered.slice(1).join("\n");
  const budget = Math.max(200, maxChars - first.length - 8);
  return `${first}\n…\n${rest.slice(-budget)}`;
}

export function buildSystemPrompt(params: {
  harness: AgentHarness;
  context: AgentContext;
  run: AgentRun;
  mcp?: McpConfig;
  specialist?: AgentSpecialistId;
  personalPrompt?: string;
  personalAnswers?: PersonalTrainingAnswer[];
}): string {
  const { harness, context, run } = params;
  const lastUser = [...run.messages].reverse().find((message) => message.role === "user");
  const query = lastUser?.content || run.prompt || "";
  const specialist = specialistById(params.specialist || "orchestrator");
  const workspace =
    context.workspaces.find((item) => item.id === run.workspaceId) ??
    context.workspaces.find((item) => item.id === harness.settings.defaultWorkspaceId) ??
    context.workspaces[0];
  const project =
    context.projects.find((item) => item.id === run.projectId) ??
    context.projects.find((item) => item.id === harness.settings.defaultProjectId);
  const knowledge = rankKnowledge(query, harness, 3);
  const automations = matchingAutomations(harness, query).slice(0, 3);
  const role = workspace?.role ? ` Role: ${workspace.role}.` : "";
  const organization =
    (workspace?.organizationId
      ? context.organizations?.find((item) => item.id === workspace.organizationId)
      : undefined) ?? context.organizations?.[0];
  const orgRole = organization?.role ? ` Role: ${organization.role}.` : "";
  const personaRole = inferPersonaRole({ workspaceRole: workspace?.role, prompt: query, title: run.title });
  const sessionMode = harness.settings.sessionMode;
  const personal = isPersonalSessionMode(sessionMode);
  const persona = compilePersonaPrompt(personaRole, workspace?.name, project?.name, { personal });
  const training = isTrainingRun(run);

  if (training) {
    const trainingRole = suggestedPersonaRole(context, run.workspaceId || harness.settings.defaultWorkspaceId);
    return buildTrainingInterviewPrompt({
      userName: firstName(context.user.name, context.user.email),
      personaRole: trainingRole,
      workspaceRole: workspace?.role,
      workspaceName: workspace?.name,
      projectName: project?.name,
      retraining: Boolean(params.personalPrompt?.trim()),
      snapshot: formatTrainingSnapshot(
        context,
        run.workspaceId || harness.settings.defaultWorkspaceId || workspace?.id,
        run.projectId || harness.settings.defaultProjectId || project?.id,
      ),
      covered: params.personalAnswers,
    });
  }

  const lines = [
    personal
      ? "You are the Fairlx Personal Agent, the user's Chief of Staff. Talk to the user in plain language."
      : "You are the Fairlx Agent. Talk to the user in plain language.",
    persona,
    `Mode: ${run.mode === "agent" ? "tools on" : "chat only"}.`,
    workspace
      ? `Workspace: ${workspace.name}.${role} workspaceId: ${workspace.id}`
      : "No workspace selected.",
    organization
      ? `Organization: ${organization.name}.${orgRole} organizationId: ${organization.id}`
      : workspace?.organizationId
        ? "This workspace belongs to an organization. Call fairlx_organization_get for the name."
        : "No organization (personal workspace).",
    project
      ? `Project: ${project.name}${project.key ? ` (${project.key})` : ""}. projectId: ${project.id}${
          project.customLabels?.length
            ? ` Labels: ${project.customLabels.map((l) => l.name).join(", ")}.`
            : ""
        }`
      : "No project selected.",
    formatProjectGithubLine(context, project?.id),
  ];
  if (personal) lines.push(SESSION_MODE_INSTRUCTIONS.personal);
  else lines.push(SESSION_MODE_INSTRUCTIONS[sessionMode || "agent"]);
  if (personal && params.personalPrompt?.trim()) {
    lines.push(
      "",
      "Trained Personal Agent operating system (user-authored; follow over generic defaults):",
      params.personalPrompt.trim(),
    );
  }
  const instructionBrief = userInstructionBrief(run.messages);
  const sandboxAuthFailed = runHasNonRetryableSandboxAuth({
    events: run.events,
    messages: run.messages,
  });
  const azurePreviewAsk = conversationWantsAzureSandbox(query);
  if (sandboxAuthFailed && azurePreviewAsk) {
    lines.push(
      "",
      "HARD STOP: Azure sandbox login failed with AADSTS700016. Do not call coding_session_start. Do not offer GitHub Pages, raw.githubusercontent.com, or local clone as a preview. Tell the user to fix AZURE_SANDBOX_TENANT_ID and AZURE_SANDBOX_CLIENT_ID so they belong to the same Entra app registration.",
    );
  }
  if (instructionBrief && !(sandboxAuthFailed && azurePreviewAsk)) {
    lines.push(
      "",
      "User instructions in this chat (already given — do not restart discovery or ask what to build):",
      instructionBrief,
    );
  }
  const userTexts = run.messages
    .filter((message) => message.role === "user")
    .map((message) => stripAttachedFiles(message.content).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!userTexts.length && query) userTexts.push(query.replace(/\s+/g, " ").trim());
  lines.push("", formatDeleteIntentContext(userTexts));
  if (query) lines.push(`Task: ${query.slice(0, 1200)}`);
  const connected = (harness.plugins ?? []).filter((plugin) => plugin.status === "connected");
  const githubLinked = hasProjectGithubRepo(context, project?.id);
  if (connected.length) {
    lines.push(
      `Plugins: ${connected.map((plugin) => plugin.displayName).join(", ")}${
        githubLinked && hasGithubAccount(context) ? ". GitHub repository already attached — do not request GitHub access." : hasGithubAccount(context) ? ". GitHub account already connected — do not request GitHub access." : ""
      }.`,
    );
  } else if (githubLinked && hasGithubAccount(context)) {
    lines.push(
      "Plugins: Fairlx platform and the attached GitHub repository. Code actions run as this user's GitHub account. Never call request_capability for GitHub. Mail still needs connecting only if you send email.",
    );
  } else if (githubLinked) {
    lines.push(
      "Plugins: Fairlx platform. A GitHub repository is attached, but this user must connect their GitHub account before code actions.",
    );
  } else if (hasGithubAccount(context)) {
    lines.push(
      "Plugins: Fairlx platform and the connected GitHub account. Never call request_capability for GitHub. Mail still needs connecting only if you send email.",
    );
  } else {
    lines.push("Plugins: Fairlx platform only. Mail, GitHub write, and extra MCP need connecting.");
  }
  const permission = harness.settings.permissionType === "all_access" ? "all_access" : "staged";
  lines.push(`Permission type: ${permission}. Fairlx RBAC still applies to every write.`);
  if (permission === "all_access") {
    lines.push(
      "All-access mode: create and update without waiting for Accept. You have delete tools. If Conversation delete intent is requested, you may delete those named records without Accept — still think twice and skip items that are still important. If intent is not requested or forbidden, never delete; create or update instead.",
    );
  } else {
    lines.push(
      "Staged mode: create/update work items run immediately. Mail, GitHub writes/PRs, deletes, invites, project create, and project documents wait for Accept. Only delete when Conversation delete intent is requested.",
    );
  }
  lines.push(
    "",
    "Rules:",
    ...SYSTEM_PROMPT_RULE_LINES,
    "- For build/change work (start building, implement, scaffold, edit the repo): inspect with github_list_files / github_read_file / fairlx_sprint_list (active sprint only). Then call submit_implementation_plan. Do not fan out specialists, write GitHub files, open PRs, or start a coding session until the user Accepts that plan (autonomous coding / @Fairlx-auto / all_access skips that extra Accept). After Accept, call coding_session_start and wait until previewLive is true. Then call coding_session_implement so Claude Code or Codex edits /workspace in the Azure sandbox. Never github_write_file or github_open_pr files[] while a sandbox is bound. Open the PR from branch fairlx/{key} after sandbox git push. Call coding_session_browser after the app is up. Never wrap coding_session_status in mcp_call — call it directly. If a tool returns blocked:true, stop retrying that tool and answer the user.",
    "- For other work, independent specialists MUST launch together: emit every delegate_agent call in the same assistant step (not one per turn). Each call is one subject. The runtime runs them in parallel (up to 6 at once). Do not wait for one specialist to finish before launching others that do not depend on its result.",
    "- fairlx_sprint_plan once to set the whole timeline (name, goal, startDate, endDate). That updates Sprint 1/2 in place and folds duplicate numbered sprints together. Do not call fairlx_sprint_create ten times, do not move every item to the backlog first, and never pass the project id as sprintId. After the plan, list sprints if you need workingDays vs estimatedBuildDays, then bulk-move items by sprint name.",
    "- To unassign every sprint item, call fairlx_work_item_bulk_update once with clearAssignees: true — do not pass assignPercent 0 with a person, and do not list first. To put one person on every item in a named sprint, call it once with sprintId as \"Sprint 1\" (name or number) and assigneeIds: [\"Name\"]; that replaces assignees.",
    "- Documentation is not parallel specialist work. Do not emit one delegate_agent per PRD, FRD, BRD, or other document type. A researcher may search the web first; then one writer saves at most two researched documents.",
    "- For billing, usage, spend, wallet balance, invoices, or cost by model (Grok, Luna, DeepSeek), call fairlx_usage_summary. Pass scope=organization (or organizationId) for the org bill; omit ids for this workspace. period is YYYY-MM. Do not search_harness for billing — spend lives in the usage ledger, not local knowledge.",
    "- Org departments own org permissions (billing, members, settings). List them with fairlx_department_list. Create with fairlx_department_create — pass departments: [{ name, permissions }] using keys like org.members.view and org.billing.manage. Add keys to an existing department with fairlx_department_permission_add. Do not invent org_department_create, create_role, or permission_grant.",
    githubLinked && hasGithubAccount(context)
        ? "- GitHub is attached to this project. Code actions run as this user's GitHub account. Call github_list_files first, then github_read_file only on listed paths. A missing path is a skip, not a stop. Never call request_capability for code.read or code.write. Never say a GitHub action is unavailable — use github_update_repo (visibility), github_write_file, github_delete_file, github_open_pr, github_merge_pr, github_list_prs, github_create_issue, github_list_issues, github_comment_issue, github_close_issue, github_list_branches, and github_list_releases. For implementation, call submit_implementation_plan first; after Accept, call coding_session_start so clone/install/start/preview run in Azure — never git or shell on the Fairlx host. Wait for previewLive=true (coding_session_status). Implement with coding_session_implement (Claude Code or Codex in the sandbox). github_write_file and github_open_pr files[] are refused while a sandbox is bound. Pass files[] only when no coding session sandbox exists."
      : githubLinked
        ? "- A GitHub repository is attached to this project, but this user has not connected their GitHub account. Call request_capability with code.write so they can Sign in with GitHub. Do not use a project token."
      : hasGithubAccount(context)
        ? "- GitHub account is connected to this user's Fairlx profile but this project has no attached repo. Signing in to Fairlx with GitHub counts as connected — do not ask them to connect GitHub again. If they asked to connect/link/attach an existing repo (e.g. ANCIENTINSANE/Fairlx-Dev), call github_link_repo with owner and repo. Do not github_create_repo. Do not call request_capability. Call github_list_repos (pass query if they named a product) to search their GitHub.com account. fairlx_github_repo_list only lists Fairlx attachments — an empty list does not mean GitHub is disconnected. After you have owner/repo, github_list_files with repoId owner/repo. If they asked to create a new repo, github_list_owners then github_create_repo (private true by default, linkToProject true only when they can attach). If github_list_owners returned needsOwnerChoice and they replied with a login (ANCIENTINSANE or an org), call github_create_repo with that owner immediately — do not say create/README tools are unavailable. After create, github_write_file path README.md if they asked for a README. To make a repo private or public, call github_update_repo with owner, repo, and private true/false — do not say visibility cannot be changed."
        : "- No GitHub repo is attached and this user has not connected GitHub to their Fairlx profile. Do not call github_write_file, github_open_pr, or coding_session_start. If they asked to create a GitHub repository, call request_capability with code.write so they can Sign in with GitHub or paste a PAT. Do not block planning or documentation on that.",
    `- ${documentationPackInstructions(hasProjectGithubRepo(context, project?.id))} ${PROJECT_DOC_MARKDOWN_GUIDE}`,
    "- Be concise in chat replies. Project documents are the opposite: long, cited research studies. Never save a short outline.",
  );

  const storedPlan = resolveRunImplementationPlan(run);
  if (storedPlan && !(sandboxAuthFailed && azurePreviewAsk)) {
    lines.push(
      "",
      planIsAccepted(storedPlan) ? "Accepted implementation plan — execute this, do not replan:" : "Draft implementation plan (waiting for Accept):",
      implementationPlanMarkdown(storedPlan),
    );
  }

  if (knowledge.length) {
    lines.push("", "Notes:");
    for (const item of knowledge) {
      lines.push(`- ${item.title}: ${item.content.slice(0, 180)}`);
    }
  }
  if (automations.length) {
    lines.push("", "Automations:");
    for (const item of automations) {
      lines.push(`- ${item.name}: ${item.action}`);
    }
  }
  const attachedFromRun = params.run.messages.flatMap((message) =>
    message.role === "user" ? extractAttachedFiles(message.content) : [],
  );
  const attached = attachedFromRun.length ? attachedFromRun : extractAttachedFiles(query);
  if (attached.length) {
    const subjects = subjectsFromFiles(attached);
    lines.push("", "Attached spec files (full text is in the user message — do not search for them):");
    for (const file of attached) {
      lines.push(`- ${file.name} (${file.body.length} chars)`);
    }
    if (subjects.length) {
      lines.push(
        "Subjects — when creating work items, call delegate_agent once per subject with that heading as subject. When writing project documentation, ignore this split: research on the web, then save at most two long cited documents:",
      );
      lines.push(subjectsToc(subjects));
    }
  }
  if (specialist !== "orchestrator" && !personal) {
    const specialistDef = AGENT_SPECIALISTS.find((item) => item.id === specialist);
    const definition = AGENT_DEFINITIONS[specialist];
    lines.push(
      "",
      `Stay in the ${specialistDef?.name ?? specialist} role: ${definition?.identity ?? specialistDef?.role ?? ""}`.trim(),
    );
    if (definition?.done) lines.push(`Done when: ${definition.done}`);
  }
  return lines.join("\n");
}
