import { describe, expect, it } from "vitest";

import type { AgentToolCall, AgentToolEvent, ImplementationPlan } from "../types";
import {
  applyPlanProgressFromTool,
  blockedBuildGateResult,
  blockedErrorDumpResult,
  buildGateShouldBlock,
  codingSessionArgsFromPlan,
  compactImplementationPlan,
  conversationLooksLikeError,
  conversationLooksLikeInspect,
  conversationLooksLikeUiFollowUp,
  conversationWantsBuildOrChange,
  conversationWantsNewPlanSlice,
  conversationWantsSessionPreview,
  currentPhaseDirective,
  describePlanSituation,
  filterCallsForBuildGate,
  filterCallsForErrorDump,
  followUpImplementPrompt,
  implementationPlanFromEvents,
  implementationPlanMarkdown,
  mergeImplementationPlans,
  parseImplementationPlan,
  persistImplementationPlan,
  planCompletion,
  planIsAccepted,
  planPanelModel,
  resolveRunImplementationPlan,
  runHasAcceptedPlan,
  shouldUseInspectModel,
} from "./implementation-plan";

function call(name: string, args: Record<string, unknown> = {}): AgentToolCall {
  return { id: crypto.randomUUID(), name, arguments: JSON.stringify(args) };
}

const samplePlan = {
  title: "Ship agent-harness",
  summary: "Clone, install, preview, then implement.",
  phases: [
    {
      title: "Inspect",
      tasks: [
        { title: "Clone Azure session", specialist: "git" },
        { title: "Read README", specialist: "planner" },
      ],
    },
    {
      title: "Build",
      tasks: [{ title: "Implement doctor CLI", specialist: "builder" }],
    },
  ],
  repo: { owner: "ANCIENTINSANE", name: "agent-harness", exists: true },
  execution: { codingSession: true, exposePort: 3000 },
};

describe("build/change intent", () => {
  it("detects start building and inspect prompts", () => {
    expect(conversationWantsBuildOrChange("start building the project")).toBe(true);
    expect(conversationWantsBuildOrChange("implement the doctor CLI")).toBe(true);
    expect(conversationWantsBuildOrChange("how to start and where to start")).toBe(true);
    expect(conversationWantsBuildOrChange("what is the organization name?")).toBe(false);
    expect(conversationLooksLikeInspect("tell me about this repo")).toBe(true);
    expect(conversationLooksLikeInspect("read the README")).toBe(true);
  });

  it("does not re-block preview/status follow-ups after a build conversation", () => {
    expect(conversationWantsSessionPreview("show me coding sessions preview")).toBe(true);
    expect(conversationWantsSessionPreview("azure preview links")).toBe(true);
    expect(conversationWantsSessionPreview("use azure sandbox")).toBe(true);
    expect(buildGateShouldBlock("start building\nshow me coding sessions preview", "show me coding sessions preview", false)).toBe(
      false,
    );
    expect(buildGateShouldBlock("how to start", "go on", false)).toBe(true);
    expect(buildGateShouldBlock("start building", "start building", true)).toBe(false);
  });

  it("keeps inspect/plan on the cheap model until Accept", () => {
    expect(shouldUseInspectModel("tell me about this project", false)).toBe(true);
    expect(shouldUseInspectModel("start building the project", false)).toBe(true);
    expect(shouldUseInspectModel("start building the project", true)).toBe(false);
    expect(shouldUseInspectModel("assign Ada to Sprint 1", false)).toBe(false);
  });

  it("treats pasted compiler errors as bugs, not start-building", () => {
    const dump = [
      "## Error Type",
      "Build Error",
      "## Error Message",
      "  × Unexpected token. Did you mean `{'}'}` or `&rbrace;`?",
      "## Build Output",
      "./src/features/sprints/components/enhanced-backlog-screen.tsx",
      "Error:   × Unexpected token",
    ].join("\n");
    expect(conversationLooksLikeError(dump)).toBe(true);
    expect(conversationWantsBuildOrChange(dump)).toBe(false);
    expect(shouldUseInspectModel(dump, false)).toBe(true);
    expect(buildGateShouldBlock("start building\n" + dump, dump, false)).toBe(false);
    expect(conversationLooksLikeError("start building the project")).toBe(false);
    expect(conversationLooksLikeError("AADSTS700016: Application with identifier was not found in the directory")).toBe(
      true,
    );
  });
});

describe("filterCallsForBuildGate", () => {
  it("blocks parallel specialists, writes, PRs, and coding sessions before plan Accept", () => {
    const { allowed, blocked } = filterCallsForBuildGate([
      call("github_list_files"),
      call("delegate_agent", { agent: "planner", task: "Draft the plan" }),
      call("delegate_agent", { agent: "git", task: "Open a PR" }),
      call("delegate_agent", { agent: "tester", task: "Write tests" }),
      call("delegate_agent", { agent: "reviewer", task: "Review" }),
      call("delegate_agent", { agent: "builder", task: "Write files" }),
      call("github_open_pr", { title: "Bootstrap" }),
      call("github_write_file", { path: "README.md" }),
      call("coding_session_start", { workItemId: "impl" }),
      call("submit_implementation_plan", samplePlan),
    ]);
    expect(allowed.map((item) => item.name).sort()).toEqual(
      ["delegate_agent", "github_list_files", "submit_implementation_plan"].sort(),
    );
    expect(JSON.parse(allowed.find((item) => item.name === "delegate_agent")!.arguments).agent).toBe("planner");
    expect(blocked.map((item) => item.name)).toEqual([
      "delegate_agent",
      "delegate_agent",
      "delegate_agent",
      "delegate_agent",
      "github_open_pr",
      "github_write_file",
      "coding_session_start",
    ]);
    expect(JSON.parse(blockedBuildGateResult(blocked[0]!)).blocked).toBe(true);
  });

  it("allows compact Fairlx list/get reads during planning", () => {
    const { allowed, blocked } = filterCallsForBuildGate([
      call("fairlx_sprint_list"),
      call("fairlx_work_item_list", { sprintId: "s1" }),
      call("fairlx_project_get"),
      call("fairlx_work_item_create", { title: "New" }),
    ]);
    expect(allowed.map((item) => item.name)).toEqual([
      "fairlx_sprint_list",
      "fairlx_work_item_list",
      "fairlx_project_get",
    ]);
    expect(blocked.map((item) => item.name)).toEqual(["fairlx_work_item_create"]);
  });

  it("allows session status, PR lists, and mcp_call unwraps of inspect tools during the gate", () => {
    const { allowed, blocked } = filterCallsForBuildGate([
      call("coding_session_status"),
      call("agent_job_status", { jobId: "j1" }),
      call("github_list_prs"),
      call("github_list_branches"),
      call("mcp_call", { server: "fairlx", tool: "fairlx_coding_session_status" }),
      call("mcp_call", { server: "fairlx", tool: "fairlx_work_item_create" }),
    ]);
    expect(allowed.map((item) => item.name)).toEqual([
      "coding_session_status",
      "agent_job_status",
      "github_list_prs",
      "github_list_branches",
      "mcp_call",
    ]);
    expect(blocked.map((item) => item.name)).toEqual(["mcp_call"]);
  });
});

describe("filterCallsForErrorDump", () => {
  it("blocks website/plan/issue creation and allows reading and fixing the cited file", () => {
    const { allowed, blocked } = filterCallsForErrorDump([
      call("github_read_file", { path: "src/features/sprints/components/enhanced-backlog-screen.tsx" }),
      call("github_write_file", { path: "src/features/sprints/components/enhanced-backlog-screen.tsx" }),
      call("submit_implementation_plan", samplePlan),
      call("coding_session_start", { workItemId: "impl" }),
      call("fairlx_work_item_create", { title: "Make a website" }),
      call("github_create_repo", { name: "new-site" }),
      call("delegate_agent", { agent: "builder", task: "Scaffold the app" }),
    ]);
    expect(allowed.map((item) => item.name)).toEqual(["github_read_file", "github_write_file"]);
    expect(blocked.map((item) => item.name)).toEqual([
      "submit_implementation_plan",
      "coding_session_start",
      "fairlx_work_item_create",
      "github_create_repo",
      "delegate_agent",
    ]);
    expect(JSON.parse(blockedErrorDumpResult(blocked[0]!)).reason).toBe("pasted_error");
  });
});

describe("implementation plan model", () => {
  it("parses phases and defaults coding-session execution", () => {
    const plan = parseImplementationPlan(samplePlan);
    expect(plan?.title).toBe("Ship agent-harness");
    expect(plan?.phases).toHaveLength(2);
    expect(plan?.phases[0]?.tasks[0]?.specialist).toBe("git");
    expect(plan?.execution?.exposePort).toBe(3000);
    expect(planIsAccepted({ ...plan!, status: "accepted" })).toBe(true);
  });

  it("renders markdown with checkboxes and completion percent", () => {
    const plan = parseImplementationPlan(samplePlan)!;
    const done: ImplementationPlan = applyPlanProgressFromTool(
      { ...plan, status: "accepted" },
      "coding_session_start",
    );
    const panel = planPanelModel(done)!;
    expect(panel.percent).toBeGreaterThan(0);
    expect(panel.markdown).toMatch(/# Ship agent-harness/);
    expect(panel.markdown).toMatch(/- \[x\] Clone Azure session/);
    expect(panel.markdown).toMatch(/- \[ \] Implement doctor CLI/);
    expect(implementationPlanMarkdown(done)).toMatch(/Progress: \*\*/);
  });

  it("reads a plan from submit_implementation_plan events", () => {
    const events: AgentToolEvent[] = [
      {
        id: "e1",
        type: "submit_implementation_plan",
        title: "Ship agent-harness",
        payload: samplePlan,
        createdAt: new Date().toISOString(),
        runId: "r1",
      },
    ];
    const parsed = implementationPlanFromEvents(events);
    expect(parsed?.title).toBe("Ship agent-harness");
    expect(planPanelModel(parsed)?.percent).toBe(0);
  });

  it("starts a coding session from the plan with a fallback work item", () => {
    const plan = parseImplementationPlan(samplePlan)!;
    expect(codingSessionArgsFromPlan(plan, "WEB-1")).toEqual({ workItemId: "WEB-1", exposePort: 3000 });
    expect(codingSessionArgsFromPlan({ ...plan, execution: { codingSession: false } }, "WEB-1")).toBeNull();
    expect(codingSessionArgsFromPlan(plan)?.workItemId).toBe("impl");
  });

  it("compacts a plan for run extra storage", () => {
    const fat = parseImplementationPlan({
      ...samplePlan,
      summary: "x".repeat(4000),
      phases: Array.from({ length: 10 }, (_, i) => ({
        title: `Phase ${i}`,
        tasks: Array.from({ length: 20 }, (_, j) => ({ title: `Task ${i}-${j}` })),
      })),
    })!;
    const compact = compactImplementationPlan(fat);
    expect(compact.summary.length).toBeLessThanOrEqual(480);
    expect(compact.phases.length).toBeLessThanOrEqual(8);
    expect(compact.phases[0]?.tasks.length).toBeLessThanOrEqual(8);
  });

  it("keeps conversion-section titles instead of slicing mid-word", () => {
    const plan = parseImplementationPlan({
      title: "Epic 2 — Content & Conversion Sections",
      summary:
        "The Features section (AGEN-10) already exists as a component. We need to build the remaining conversion sections.",
      phases: [
        {
          title: "Create UseCases.tsx with industry cards (engineering, healthcare, finance)",
          tasks: [{ title: "Import it into App.tsx between Features and Gallery" }],
        },
        {
          title: "Pricing comparison cards (Free, Pro, Enterprise)",
          tasks: [{ title: "Add a bottom call-to-action, signup form, and waitlist" }],
        },
      ],
    })!;
    const compact = compactImplementationPlan(plan);
    expect(compact.summary).toContain("conversion sections");
    expect(compact.summary).not.toMatch(/\bbu$/);
    expect(compact.phases[0]?.title).toContain("engineering");
    expect(compact.phases[0]?.tasks[0]?.title).toContain("Gallery");
    expect(compact.phases[1]?.title).toContain("Enterprise");
    expect(persistImplementationPlan(plan).phases[0]?.title).toBe(plan.phases[0]?.title);
  });

  it("prefers full event titles and overlays stored task progress", () => {
    const full = parseImplementationPlan({
      ...samplePlan,
      summary: "Clone, install, preview, then implement the doctor CLI end to end.",
    })!;
    const truncated = compactImplementationPlan({
      ...full,
      summary: full.summary.slice(0, 20),
      phases: full.phases.map((phase) => ({
        ...phase,
        title: phase.title.slice(0, 4),
        tasks: phase.tasks.map((task) => ({ ...task, title: task.title.slice(0, 8), status: "done" as const })),
      })),
    });
    const merged = mergeImplementationPlans(full, { ...truncated, status: "accepted" });
    expect(merged.summary).toContain("doctor CLI");
    expect(merged.phases[0]?.tasks[0]?.status).toBe("done");
    expect(merged.status).toBe("accepted");

    const resolved = resolveRunImplementationPlan({
      implementationPlan: { ...truncated, status: "accepted" },
      events: [
        {
          id: "e1",
          type: "submit_implementation_plan",
          title: full.title,
          payload: full,
          createdAt: new Date().toISOString(),
          runId: "r1",
        },
      ],
    });
    expect(resolved?.summary).toContain("doctor CLI");
    expect(resolved?.status).toBe("accepted");
  });

  it("recovers full titles from submit_implementation_plan tool-call arguments", () => {
    const full = parseImplementationPlan(samplePlan)!;
    const truncated = {
      title: full.title,
      summary: full.summary.slice(0, 12),
      status: "accepted" as const,
      phases: full.phases.map((phase) => ({
        ...phase,
        title: phase.title.slice(0, 4),
        tasks: phase.tasks.map((task) => ({ ...task, title: task.title.slice(0, 8), status: "done" as const })),
      })),
    };
    const resolved = resolveRunImplementationPlan({
      implementationPlan: truncated,
      events: [],
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          toolCalls: [
            {
              id: "c1",
              name: "submit_implementation_plan",
              arguments: JSON.stringify(samplePlan),
            },
          ],
        },
      ],
    });
    expect(resolved?.summary).toBe(full.summary);
    expect(resolved?.phases[0]?.tasks[0]?.title).toBe("Clone Azure session");
    expect(resolved?.phases[0]?.tasks[0]?.status).toBe("done");
    expect(resolved?.status).toBe("accepted");
  });

  it("does not crash when extra JSON kept a title but dropped phases", () => {
    const truncated = { title: "Ship agent-harness", status: "accepted" } as ImplementationPlan;
    expect(planPanelModel(truncated)).toBeNull();
    expect(planCompletion(truncated)).toEqual({ done: 0, total: 0, percent: 0 });
    expect(resolveRunImplementationPlan({ implementationPlan: truncated, events: [] })?.status).toBe("accepted");
    expect(runHasAcceptedPlan({ implementationPlan: truncated, events: [] })).toBe(true);
    const fromEvent = resolveRunImplementationPlan({
      implementationPlan: truncated,
      events: [
        {
          id: "e1",
          type: "submit_implementation_plan",
          title: "Ship agent-harness",
          payload: samplePlan,
          createdAt: new Date().toISOString(),
          runId: "r1",
        },
      ],
    });
    expect(fromEvent?.phases.length).toBe(2);
    expect(fromEvent?.status).toBe("accepted");
  });
});

describe("new focused slice vs leftover accepted plan", () => {
  const chemchaPlan = (): ImplementationPlan => ({
    title: "Chemcha multi-page responsive website expansion",
    summary: "Extend the landing page into chefs, meals, FAQ, and contact.",
    status: "accepted",
    phases: [
      {
        id: "phase-1",
        title: "Shared responsive foundation",
        tasks: [
          { id: "t1", title: "Refactor into reusable navigation", status: "done" },
          { id: "t2", title: "Define route architecture", status: "pending" },
        ],
      },
      {
        id: "phase-2",
        title: "Customer discovery pages",
        tasks: [
          { id: "t3", title: "Build Browse Meals with filters", status: "pending" },
          { id: "t4", title: "Implement chef pages", status: "pending" },
        ],
      },
    ],
  });

  it("treats a hamburger-menu prompt as a new slice, not leftover Chemcha phases", () => {
    const plan = chemchaPlan();
    const prompt = "Add a hamburger menu for small devices.";
    expect(conversationWantsNewPlanSlice(prompt, plan)).toBe(true);
    expect(buildGateShouldBlock("I want to build a product\n" + prompt, prompt, true, plan)).toBe(true);
    expect(describePlanSituation(plan, prompt)).toMatch(/new focused change/i);
    expect(currentPhaseDirective(plan)).toMatch(/Phase 1/);
  });

  it("stays on the current plan for continue / phase follow-ups", () => {
    const plan = chemchaPlan();
    expect(conversationWantsNewPlanSlice("continue", plan)).toBe(false);
    expect(conversationWantsNewPlanSlice("finish the plan", plan)).toBe(false);
    expect(buildGateShouldBlock("start building\ncontinue", "continue", true, plan)).toBe(false);
  });

  it("does not mark a later-phase implement task while phase 1 is still open", () => {
    const next = applyPlanProgressFromTool(chemchaPlan(), "coding_session_implement");
    expect(next.phases[0]?.tasks[1]?.status).toBe("pending");
    expect(next.phases[1]?.tasks[1]?.status).toBe("pending");
  });

  it("lets a new hamburger plan replace leftover Chemcha phases", () => {
    const leftover = chemchaPlan();
    const hamburger = parseImplementationPlan({
      title: "Hamburger menu for small devices",
      summary: "Add a mobile nav drawer to the existing landing page.",
      status: "accepted",
      phases: [{ title: "Mobile nav", tasks: [{ title: "Add a hamburger menu visible under 768px" }] }],
    })!;
    const resolved = resolveRunImplementationPlan({
      implementationPlan: leftover,
      events: [
        {
          id: "e-old",
          type: "submit_implementation_plan",
          title: leftover.title,
          payload: leftover,
          createdAt: new Date().toISOString(),
          runId: "r1",
        },
        {
          id: "e-new",
          type: "submit_implementation_plan",
          title: hamburger.title,
          payload: hamburger,
          createdAt: new Date().toISOString(),
          runId: "r1",
        },
      ],
    });
    expect(resolved?.title).toMatch(/Hamburger/i);
    expect(conversationWantsNewPlanSlice("Add a hamburger menu for small devices.", resolved)).toBe(false);
  });

  it("detects responsive / hamburger follow-ups and writes an implement prompt for the live preview", () => {
    expect(conversationLooksLikeUiFollowUp("make it responsive and add a hamburger menu")).toBe(true);
    expect(conversationLooksLikeUiFollowUp("build a landing page from scratch")).toBe(false);
    const prompt = followUpImplementPrompt("Add a hamburger menu for small devices.", chemchaPlan());
    expect(prompt).toMatch(/EXISTING app/i);
    expect(prompt).toMatch(/390px/);
    expect(prompt).toMatch(/Do not scaffold a new product/);
    expect(prompt).not.toMatch(/Shared responsive foundation/);
  });
});
