import { AGENT_TOOL_CATALOG } from "../constants";
import type { AgentRunMode } from "../types";
import { HARNESS_TO_MCP } from "./parse-tool-calls";

export type OpenAiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

const TOOL_PARAMETERS: Record<string, { description: string; parameters: Record<string, unknown> }> = {
  code_inspect: {
    description: "Inspect Fairlx work items, repositories, and docs related to the current user.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to inspect." },
        kind: { type: "string", enum: ["work_item", "repo", "doc", "all"] },
      },
    },
  },
  terminal: {
    description:
      "Run a shell command in the bound Azure coding-session sandbox when one exists. Otherwise record the command. Never executed on the Fairlx host.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
      },
      required: ["command"],
    },
  },
  coding_session_start: {
    description:
      "Start or resume an Azure coding session for a work item: clone the linked repo in an isolated sandbox, branch fairlx/{key}, and wait for sandboxId/previewUrl. Never runs git on the Fairlx host. After Accept this runs without a second confirmation.",
    parameters: {
      type: "object",
      properties: {
        workItemId: { type: "string", description: "Work item id or key (WEB-12)." },
        repoId: { type: "string" },
        baseBranch: { type: "string" },
        exposePort: { type: "number", description: "Port to expose after the app is healthy. Default 3000." },
      },
      required: ["workItemId"],
    },
  },
  coding_session_exec: {
    description: "Run a command inside the coding-session Azure sandbox. Never executed on the Fairlx host.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        sessionId: { type: "string" },
      },
      required: ["command"],
    },
  },
  coding_session_status: {
    description:
      "Get coding session status, sandboxId, preview URL (previewLive vs stub), coding agent, artifacts, PR, and job progress. Paste previewUrl into markdown links verbatim — do not rebuild the Azure hostname. Call this directly — do not wrap it in mcp_call.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        workItemId: { type: "string" },
        exposePort: { type: "number", description: "Expose this port on an already-running sandbox." },
      },
    },
  },
  coding_session_implement: {
    description:
      "Run Claude Code or Codex inside the Azure sandbox against /workspace. Prefer this over github_write_file. Fails clearly if those CLIs have no credentials; specialists may exec in the sandbox as fallback and must not dump GitHub files while the sandbox is bound.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Implementation instructions for the sandbox coding agent." },
        task: { type: "string" },
        sessionId: { type: "string" },
      },
    },
  },
  coding_session_browser: {
    description:
      "Open the running sandbox app in a sandbox-side browser and capture a screenshot (recording when available).",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
      },
    },
  },
  submit_implementation_plan: {
    description:
      "Submit a phased implementation plan for build/change work. Waits for Accept. Do not write GitHub files, open PRs, start a coding session, or fan out specialists until the user Accepts this plan.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        phases: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              tasks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    specialist: {
                      type: "string",
                      enum: ["planner", "researcher", "builder", "git", "reviewer", "ops", "security", "workflow", "tester"],
                    },
                  },
                  required: ["title"],
                },
              },
            },
            required: ["title", "tasks"],
          },
        },
        repo: {
          type: "object",
          properties: {
            owner: { type: "string" },
            name: { type: "string" },
            exists: { type: "boolean" },
          },
        },
        execution: {
          type: "object",
          properties: {
            codingSession: { type: "boolean" },
            exposePort: { type: "number" },
            workItemId: { type: "string" },
          },
        },
      },
      required: ["title", "phases"],
    },
  },
  github_merge_pr: {
    description: "Merge a GitHub pull request after Accept. Prefer squash.",
    parameters: {
      type: "object",
      properties: {
        pullNumber: { type: "number" },
        repoId: { type: "string" },
        mergeMethod: { type: "string", enum: ["merge", "squash", "rebase"] },
        commitTitle: { type: "string" },
      },
      required: ["pullNumber"],
    },
  },
  github_request_reviewers: {
    description: "Request reviewers on a GitHub pull request.",
    parameters: {
      type: "object",
      properties: {
        pullNumber: { type: "number" },
        reviewers: { type: "array", items: { type: "string" } },
        teamReviewers: { type: "array", items: { type: "string" } },
        repoId: { type: "string" },
      },
      required: ["pullNumber"],
    },
  },
  github_account_status: {
    description:
      "Check whether this Fairlx user has a GitHub account connected (OAuth or PAT). Use before creating a repository.",
    parameters: { type: "object", properties: {} },
  },
  github_list_owners: {
    description:
      "List the connected GitHub personal login and organizations. If more than one owner is returned, ask the user where to create the repository before github_create_repo.",
    parameters: { type: "object", properties: {} },
  },
  github_list_repos: {
    description:
      "Search this user's connected GitHub account for repositories (GitHub.com), then show Fairlx-attached project repos. fairlx_github_repo_list only returns Fairlx attachments — an empty attachment list does not mean GitHub is disconnected. Pass query to filter by name (e.g. Fairlx). To attach one to this project, call github_link_repo. Then github_list_files with repoId owner/repo.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional name filter, e.g. Fairlx." },
      },
    },
  },
  github_create_repo: {
    description:
      "Create a new GitHub repository with a README (autoInit) under the user's personal account or an organization, then link it to this Fairlx project. Defaults to private. Privileged — waits for Accept. If they asked to attach an existing repo (Fairlx-Dev, owner/repo), use github_link_repo instead. If owners.length > 1 and owner is omitted, returns needsOwnerChoice instead of creating. To change visibility on an existing repo, use github_update_repo.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Repository name." },
        owner: { type: "string", description: "GitHub login or organization. Required when the user has orgs." },
        description: { type: "string" },
        private: { type: "boolean", description: "Private repository. Defaults true. Pass false only if they asked for a public repo." },
        autoInit: { type: "boolean", description: "Create with a README. Defaults true." },
        linkToProject: { type: "boolean", description: "Link the new repo to this Fairlx project. Defaults true." },
      },
      required: ["name"],
    },
  },
  github_link_repo: {
    description:
      "Attach an existing GitHub.com repository to this Fairlx project (identity only). Use when the user says connect/link/attach a repo such as ANCIENTINSANE/Fairlx-Dev. Do not create a new repository. Do not call request_capability if GitHub is already connected. Privileged — waits for Accept.",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "GitHub owner or org, e.g. ANCIENTINSANE." },
        repo: { type: "string", description: "Repository name, e.g. Fairlx-Dev." },
        repoId: { type: "string", description: "owner/repo or GitHub URL. Alternative to owner + repo." },
        branch: { type: "string", description: "Default branch. Optional; uses GitHub default when known." },
      },
    },
  },
  github_update_repo: {
    description:
      "Update a GitHub repository the user can admin: visibility (private/public), description, or homepage. Use this when they say make it private, make it public, or change visibility. Do not say this action is unavailable. Privileged — waits for Accept. Pass owner and repo, repoId owner/repo, or omit to use the attached project repo.",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        repoId: { type: "string", description: "owner/repo or attached repo id." },
        private: { type: "boolean", description: "true for private, false for public." },
        visibility: { type: "string", enum: ["private", "public"] },
        description: { type: "string" },
        homepage: { type: "string" },
      },
    },
  },
  github_delete_file: {
    description: "Delete a file on a GitHub branch. Privileged — waits for Accept.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        message: { type: "string" },
        branch: { type: "string" },
        repoId: { type: "string" },
        owner: { type: "string" },
        repo: { type: "string" },
      },
      required: ["path"],
    },
  },
  github_list_prs: {
    description: "List pull requests in a GitHub repository.",
    parameters: {
      type: "object",
      properties: {
        state: { type: "string", enum: ["open", "closed", "all"] },
        repoId: { type: "string" },
        owner: { type: "string" },
        repo: { type: "string" },
      },
    },
  },
  github_list_issues: {
    description: "List GitHub issues (not pull requests) in a repository.",
    parameters: {
      type: "object",
      properties: {
        state: { type: "string", enum: ["open", "closed", "all"] },
        repoId: { type: "string" },
        owner: { type: "string" },
        repo: { type: "string" },
      },
    },
  },
  github_create_issue: {
    description: "Create a GitHub issue. Privileged — waits for Accept.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        repoId: { type: "string" },
        owner: { type: "string" },
        repo: { type: "string" },
      },
      required: ["title"],
    },
  },
  github_close_issue: {
    description: "Close a GitHub issue. Privileged — waits for Accept.",
    parameters: {
      type: "object",
      properties: {
        issueNumber: { type: "number" },
        repoId: { type: "string" },
        owner: { type: "string" },
        repo: { type: "string" },
      },
      required: ["issueNumber"],
    },
  },
  github_comment_issue: {
    description: "Comment on a GitHub issue or pull request. Privileged — waits for Accept.",
    parameters: {
      type: "object",
      properties: {
        issueNumber: { type: "number" },
        body: { type: "string" },
        repoId: { type: "string" },
        owner: { type: "string" },
        repo: { type: "string" },
      },
      required: ["issueNumber", "body"],
    },
  },
  github_list_branches: {
    description: "List branches in a GitHub repository.",
    parameters: {
      type: "object",
      properties: {
        repoId: { type: "string" },
        owner: { type: "string" },
        repo: { type: "string" },
      },
    },
  },
  github_list_releases: {
    description: "List GitHub releases for a repository.",
    parameters: {
      type: "object",
      properties: {
        repoId: { type: "string" },
        owner: { type: "string" },
        repo: { type: "string" },
      },
    },
  },
  file_search: {
    description: "Search Fairlx docs and work items.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  web_search: {
    description:
      "Search Wikipedia and the public web. Use several distinct queries (market, competitors, users, regulations). Then web_fetch the best URLs. Required before creating project docs.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  web_fetch: {
    description:
      "Fetch a public http(s) page and return visible text for research. Use after web_search. Do not fetch localhost or private IPs.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  database_query: {
    description: "Query Fairlx workspaces, projects, work items, or docs.",
    parameters: {
      type: "object",
      properties: {
        collection: { type: "string", enum: ["workspaces", "projects", "work_items", "docs", "all"] },
        query: { type: "string" },
      },
    },
  },
  use_skill: {
    description: "Load an enabled harness skill by id or name.",
    parameters: {
      type: "object",
      properties: {
        skillId: { type: "string" },
        name: { type: "string" },
      },
    },
  },
  list_workspaces: {
    description: "List the user's Fairlx workspaces.",
    parameters: { type: "object", properties: {} },
  },
  list_projects: {
    description: "List Fairlx projects, optionally filtered by workspaceId.",
    parameters: {
      type: "object",
      properties: { workspaceId: { type: "string" } },
    },
  },
  list_work_items: {
    description: "List assigned work items, optionally filtered.",
    parameters: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        projectId: { type: "string" },
        query: { type: "string" },
      },
    },
  },
  mcp_list: {
    description: "List configured MCP servers without leaking secrets.",
    parameters: { type: "object", properties: {} },
  },
  mcp_call: {
    description: "Call a tool on an external MCP server only. For Fairlx platform data, call the native fairlx_* tools directly — do not wrap them in mcp_call. Fairlx *_delete tools: read Conversation delete intent first.",
    parameters: {
      type: "object",
      properties: {
        server: { type: "string" },
        tool: { type: "string" },
        arguments: { type: "object" },
      },
      required: ["tool"],
    },
  },
  mcp_resources: {
    description: "List MCP resources for a server, including fairlx://me/* personal content.",
    parameters: {
      type: "object",
      properties: { server: { type: "string" } },
    },
  },
  delegate_agent: {
    description:
      "Delegate one subject to a specialist. For build/change work, only the planner may run before the user Accepts submit_implementation_plan. After Accept, independent work MUST be multiple delegate_agent calls in the same step so they run in parallel inside the coding session. Set subject to a plan task or spec heading.",
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          enum: ["planner", "researcher", "builder", "git", "reviewer", "ops", "security", "workflow", "tester"],
        },
        subject: {
          type: "string",
          description: "One spec heading or module name. Required when splitting a product spec.",
        },
        task: { type: "string" },
      },
      required: ["task"],
    },
  },
  search_harness: {
    description: "Search chats, workspaces, projects, skills, knowledge, automations, docs, repos, MCP, and staging.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  create_project: {
    description: "Create a Fairlx project in a workspace the user belongs to.",
    parameters: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
      },
      required: ["name"],
    },
  },
  git_status: {
    description:
      "Show Fairlx-attached GitHub repositories, this user's GitHub.com repositories when their account is connected, and the Agent git staging buffer. Empty Fairlx attachments does not mean GitHub is disconnected.",
    parameters: { type: "object", properties: {} },
  },
  git_stage: {
    description: "Stage a planned change. Does not run git on the host.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        summary: { type: "string" },
        repoId: { type: "string" },
        branch: { type: "string" },
      },
      required: ["path"],
    },
  },
  git_unstage: {
    description: "Unstage a planned change by id or path.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" }, path: { type: "string" } },
    },
  },
  git_commit_plan: {
    description: "Mark staged items as a planned commit. Never executes git commit on the host.",
    parameters: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
  },
  run_automation: {
    description: "Load a saved automation and return the action the Agent should follow.",
    parameters: {
      type: "object",
      properties: { automationId: { type: "string" }, name: { type: "string" } },
    },
  },
  personal_read: {
    description: "Read personal MCP content: harness, skills, knowledge, rules, automations, chats, staging.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["harness", "skills", "knowledge", "rules", "automations", "chats", "staging"],
        },
        query: { type: "string" },
      },
    },
  },
  ask_user: {
    description:
      "Ask the user one question in chat and pause until they answer. Invent 3 short option labels. The UI shows them as radio choices and always adds Type your own as the last option, where the user can type something else. Do not add an Other option. Do not mention the tool name.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The single question to ask." },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Exactly 3 invented short labels. Optional em-dash description after the title. Never a hardcoded set. Never include Other or Type your own.",
        },
        allowCustom: {
          type: "boolean",
          description: "Always true. The UI always adds Type your own as the last radio option.",
        },
      },
      required: ["question", "options"],
    },
  },
  page_ui: {
    description:
      "Change the Fairlx page the user is looking at. Use for view chrome only: switch task-view tab, timeline zoom, filters, select/expand a row, or navigate in-app. Do not use this to create or update work items — call fairlx_work_item_* / fairlx_sprint_* for data changes. The open screen applies the action immediately.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["set_view", "set_zoom", "set_filters", "reset_filters", "select_item", "expand", "collapse", "navigate"],
        },
        view: {
          type: "string",
          description: "For set_view: dashboard, table, kanban, calendar, timeline, backlog, or issues.",
        },
        zoom: {
          type: "string",
          description: "For set_zoom: days, weeks, months, or quarters.",
        },
        filters: {
          type: "object",
          description: "For set_filters: status, type, search, epicId, sprintId, label, assigneeId.",
          additionalProperties: { type: ["string", "null"] },
        },
        itemId: {
          type: "string",
          description: "Work item key (AGEN-7), document id, or sprint id for select_item / expand / collapse.",
        },
        path: {
          type: "string",
          description: "In-app path for navigate, such as /workspaces/{workspaceId}/timeline.",
        },
      },
      required: ["action"],
    },
  },
  save_personal_agent: {
    description:
      "Save the trained Personal Agent standing prompt from this interview. Call only after covering the agenda. Include every question and answer plus a detailed compiledPrompt.",
    parameters: {
      type: "object",
      properties: {
        personaRole: { type: "string", enum: ["tech_lead", "frontend", "qa", "pm"] },
        jobTitle: { type: "string" },
        compiledPrompt: { type: "string" },
        answers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              answer: { type: "string" },
            },
            required: ["question", "answer"],
          },
        },
      },
      required: ["personaRole", "answers", "compiledPrompt"],
    },
  },
  request_capability: {
    description:
      "Request the user connect a missing plugin. Use for email.send when mail is not configured. Never call this for GitHub if the prompt says the account is connected, a repo is linked, or they asked to attach an existing GitHub.com repo — call github_link_repo instead.",
    parameters: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          enum: ["email.send", "code.read", "code.write", "security.review", "chat.notify"],
        },
        reason: { type: "string" },
      },
      required: ["capability"],
    },
  },
  persist_memory: {
    description: "Store a short verified fact in harness STATE.",
    parameters: {
      type: "object",
      properties: { fact: { type: "string" } },
      required: ["fact"],
    },
  },
  mail_send: {
    description: "Send email through a connected Outlook, Gmail, Resend, or mail MCP plugin. Waits for Accept.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        cc: { type: "string" },
        workItemKey: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
  },
  notify_channel: {
    description:
      "Post a short message to the project's connected Slack / Discord / Microsoft Teams channel, or send a Fairlx in-app notification to a user. Used by automation loops and supervisor updates. target: #channel-id, channel name, user id, or email; omit for the project default channel.",
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", enum: ["slack", "discord", "teams", "in_app", "auto"] },
        target: { type: "string" },
        message: { type: "string" },
        workItemKey: { type: "string" },
        threadTs: { type: "string" },
      },
      required: ["message"],
    },
  },
  github_list_files: {
    description:
      "List files in a GitHub repository. Omit path for the repo root. Omit branch to use the coding session branch (fairlx/{key}) when a sandbox is bound — do not assume main. Unpushed sandbox work is in /workspace via coding_session_exec, not GitHub.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to list. Omit for the repo root." },
        repoId: { type: "string", description: "Fairlx repo id or owner/repo. Omit to use the linked project repo." },
        branch: {
          type: "string",
          description: "Git branch. Omit to use the coding session head branch when a sandbox is bound, otherwise the repo default.",
        },
      },
    },
  },
  github_read_file: {
    description:
      "Read a file from a linked GitHub repository. Path must come from github_list_files. Omit branch to use the coding session branch when a sandbox is bound. Missing files are a skip, not a stop. For unpushed work, coding_session_exec in /workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Exact file path from a prior github_list_files listing." },
        repoId: { type: "string", description: "Fairlx repo id or owner/repo. Omit to use the linked project repo." },
        branch: { type: "string" },
      },
      required: ["path"],
    },
  },
  github_write_file: {
    description:
      "Create or update a file on a GitHub branch. Use after github_create_repo to replace the stub README with a detailed README.md. Pass owner and repo from the create result when the project just linked. Never runs git on the Fairlx host. Waits for Accept.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        message: { type: "string" },
        branch: { type: "string" },
        repoId: { type: "string", description: "owner/repo or attached repo id." },
        owner: { type: "string" },
        repo: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  github_open_pr: {
    description: "Open a GitHub pull request. Pass files[] to commit then open the PR. Waits for Accept. Large batches become a durable job.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        head: { type: "string" },
        base: { type: "string" },
        repoId: { type: "string" },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
      required: ["title"],
    },
  },
  security_review: {
    description: "Scan linked source for vulnerabilities. Isolated. Never exploits production.",
    parameters: {
      type: "object",
      properties: {
        repoId: { type: "string" },
        deep: { type: "boolean", description: "Queue a durable job that scans more files." },
      },
    },
  },
  agent_job_status: {
    description: "Get status and result of a durable agent job.",
    parameters: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
};

export function openaiToolsForMode(mode: AgentRunMode, enabledTools: string[]): OpenAiTool[] {
  if (mode !== "agent") return [];
  const enabled = new Set(enabledTools);
  return AGENT_TOOL_CATALOG.filter((tool) => enabled.has(tool.id)).map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.id,
      description: TOOL_PARAMETERS[tool.id]?.description ?? tool.description,
      parameters: TOOL_PARAMETERS[tool.id]?.parameters ?? { type: "object", properties: {} },
    },
  }));
}

function mcpToolDescription(tool: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}): string {
  const required = Array.isArray(tool.inputSchema?.required)
    ? (tool.inputSchema.required as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const parts = [tool.description?.trim() || tool.name];
  if (required.length) parts.push(`Required arguments: ${required.join(", ")}.`);
  parts.push("Call this tool directly; do not wrap it in mcp_call.");
  return parts.join(" ");
}

export function openaiToolsForTurn(params: {
  mode: AgentRunMode;
  enabledTools: string[];
  mcpTools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}): OpenAiTool[] {
  const mcpTools = params.mcpTools ?? [];
  const mcpNames = new Set(mcpTools.map((tool) => tool.name));
  const harness = openaiToolsForMode(params.mode, params.enabledTools).filter((tool) => {
    const mapped = HARNESS_TO_MCP[tool.function.name];
    if (mapped && mcpNames.has(mapped)) return false;
    if (
      mcpNames.has("fairlx_work_item_list") &&
      (tool.function.name === "database_query" ||
        tool.function.name === "list_work_items" ||
        tool.function.name === "list_workspaces" ||
        tool.function.name === "list_projects")
    ) {
      return false;
    }
    return true;
  });
  if (params.mode !== "agent") return harness;
  const existing = new Set(harness.map((tool) => tool.function.name));
  const mcp = mcpTools
    .filter((tool) => !existing.has(tool.name))
    .map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: mcpToolDescription(tool),
        parameters: tool.inputSchema?.type ? tool.inputSchema : { type: "object", properties: tool.inputSchema ?? {} },
      },
    }));
  return [...harness, ...mcp];
}

function toolFromSpec(name: string): OpenAiTool {
  const spec = TOOL_PARAMETERS[name];
  return {
    type: "function",
    function: {
      name,
      description: spec?.description ?? name,
      parameters: spec?.parameters ?? { type: "object", properties: {} },
    },
  };
}

export function askUserTool(): OpenAiTool {
  return toolFromSpec("ask_user");
}

export function trainingSaveTool(): OpenAiTool {
  return toolFromSpec("save_personal_agent");
}
