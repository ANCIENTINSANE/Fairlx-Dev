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
      "Start or resume an Azure coding session for a work item: clone the linked repo in an isolated sandbox and branch fairlx/{key}. Privileged — waits for Accept unless all_access. Never runs git on the Fairlx host.",
    parameters: {
      type: "object",
      properties: {
        workItemId: { type: "string", description: "Work item id or key (WEB-12)." },
        repoId: { type: "string" },
        baseBranch: { type: "string" },
        exposePort: { type: "number", description: "Optional port to expose for Preview." },
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
    description: "Get coding session status, preview URL, PR, and recent sandbox events.",
    parameters: {
      type: "object",
      properties: { sessionId: { type: "string" }, workItemId: { type: "string" } },
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
  github_create_repo: {
    description:
      "Create a GitHub repository with a README (autoInit) under the user's personal account or an organization, then link it to this Fairlx project. Privileged — waits for Accept. If owners.length > 1 and owner is omitted, returns needsOwnerChoice instead of creating.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Repository name." },
        owner: { type: "string", description: "GitHub login or organization. Required when the user has orgs." },
        description: { type: "string" },
        private: { type: "boolean" },
        autoInit: { type: "boolean", description: "Create with a README. Defaults true." },
        linkToProject: { type: "boolean", description: "Link the new repo to this Fairlx project. Defaults true." },
      },
      required: ["name"],
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
      "Delegate one subject to a specialist. Independent work MUST be multiple delegate_agent calls in the same step so they run in parallel. Set subject to a spec heading (one module). Planner = timeline; builder = create that subject's work; ops = assign a percent. Do not delegate once per PRD/FRD/BRD — documentation is one builder or the orchestrator.",
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
    description: "Show linked GitHub repositories and the Agent git staging buffer.",
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
      "Ask the user one question in chat and pause until they answer. Invent 3 or 4 short option labels. The UI always shows a Type your own text box as the last option. Call this whenever you need a decision during training or Personal mode. Do not mention the tool name.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The single question to ask." },
        options: {
          type: "array",
          items: { type: "string" },
          description: "3 or 4 invented short labels the user can tap. Never a hardcoded set.",
        },
        allowCustom: {
          type: "boolean",
          description: "Always true. The UI shows an inline custom text box.",
        },
      },
      required: ["question", "options"],
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
      "Request the user connect a missing plugin. Use for email.send when mail is not configured, or code.write when GitHub is not connected and the user asked to create or link a repository. Never call this for GitHub if the prompt says the account is connected or a repo is linked.",
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
  github_list_files: {
    description:
      "List files in a linked GitHub repository. Omit repoId to use this project's linked repo. repoId may be a Fairlx id or owner/repo. Use paths from the listing; do not guess.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to list. Omit for the repo root." },
        repoId: { type: "string", description: "Fairlx repo id or owner/repo. Omit to use the linked project repo." },
        branch: { type: "string" },
      },
    },
  },
  github_read_file: {
    description:
      "Read a file from a linked GitHub repository. Path must come from github_list_files. Missing files return an error — continue the audit; do not stop.",
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
    description: "Create or update a file on a GitHub branch. Never runs git on the Fairlx host. Waits for Accept.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        message: { type: "string" },
        branch: { type: "string" },
        repoId: { type: "string" },
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
