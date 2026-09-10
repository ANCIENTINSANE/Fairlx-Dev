import type {
  AgentAutomation,
  AutomationEdge,
  AutomationFlow,
  AutomationNode,
  AutomationNodeKind,
  AutomationNotifyChannel,
  AutomationTriggerKind,
} from "../types";

/**
 * Automation loops are small graphs: a trigger, then agent / test / deploy / notify / supervisor
 * nodes joined by edges. `fail` edges loop back (e.g. tests fail → agent fixes again).
 * The graph is compiled into one autonomous agent run so the existing runtime, tools, and
 * Azure sandbox do the work — no second execution engine.
 */

export const AUTOMATION_NODE_KINDS: AutomationNodeKind[] = [
  "trigger",
  "agent",
  "test",
  "deploy",
  "notify",
  "supervisor",
  "close",
];

export const AUTOMATION_TRIGGER_KINDS: Array<{ id: AutomationTriggerKind; label: string; hint: string }> = [
  { id: "work_item_created", label: "Work item created", hint: "A bug, story, or task is raised." },
  { id: "work_item_status", label: "Status changed", hint: "An item moves to a status (e.g. Ready)." },
  { id: "work_item_assigned", label: "Assigned to Fairlx", hint: "Someone assigns the Fairlx agent." },
  { id: "comment_mention", label: "@Fairlx in a comment", hint: "Someone replies @Fairlx on the item." },
  { id: "chat_mention", label: "@Fairlx in Slack / Discord / Teams", hint: "A thread reply mentions Fairlx." },
  { id: "manual", label: "Run button only", hint: "Never fires on its own." },
];

export const AUTOMATION_NOTIFY_CHANNELS: Array<{ id: AutomationNotifyChannel; label: string }> = [
  { id: "slack", label: "Slack" },
  { id: "discord", label: "Discord" },
  { id: "teams", label: "Microsoft Teams" },
  { id: "email", label: "Email" },
  { id: "in_app", label: "Fairlx notification" },
];

export type AutomationEvent = {
  kind: AutomationTriggerKind;
  workspaceId?: string;
  projectId?: string;
  workItem?: {
    id: string;
    key?: string;
    title?: string;
    description?: string;
    type?: string;
    status?: string;
    priority?: string;
    assigneeIds?: string[];
  };
  /** Comment / chat text that carried the mention. */
  text?: string;
  source?: "slack" | "discord" | "teams" | "whatsapp" | "comment" | "fairlx";
  actor?: { id?: string; name?: string };
};

function short(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function newNode(kind: AutomationNodeKind, x: number, y: number, config: AutomationNode["config"] = {}): AutomationNode {
  return { id: `${kind[0]}${short()}`, kind, x: Math.round(x), y: Math.round(y), config: { ...defaultNodeConfig(kind), ...config } };
}

export function newEdge(from: string, to: string, when: AutomationEdge["when"] = "always"): AutomationEdge {
  return { id: `e${short()}`, from, to, ...(when && when !== "always" ? { when } : {}) };
}

export function defaultNodeConfig(kind: AutomationNodeKind): AutomationNode["config"] {
  switch (kind) {
    case "trigger":
      return { kind: "work_item_created", itemTypes: ["BUG"], priorities: [], statuses: [], keyword: "" };
    case "agent":
      return {
        prompt: "Investigate the work item, reproduce it in the sandbox, and fix the root cause. Keep the change small.",
        autoMode: true,
      };
    case "test":
      return { command: "npm test -- --run", maxRetries: 2 };
    case "deploy":
      return { mode: "open_pr", command: "" };
    case "notify":
      return { channel: "slack", target: "", message: "Fairlx finished {{key}}: {{title}}" };
    case "supervisor":
      return { target: "", channel: "in_app", notifyOn: ["start", "fail", "done"], requireApproval: false };
    case "close":
      return { status: "DONE", comment: "Fixed by Fairlx automation." };
    default:
      return {};
  }
}

export function nodeTitle(kind: AutomationNodeKind): string {
  switch (kind) {
    case "trigger":
      return "Trigger";
    case "agent":
      return "Fairlx agent";
    case "test":
      return "Run tests";
    case "deploy":
      return "Deploy / PR";
    case "notify":
      return "Notify";
    case "supervisor":
      return "Supervisor";
    case "close":
      return "Close item";
    default:
      return kind;
  }
}

export function emptyFlow(): AutomationFlow {
  return { version: 1, nodes: [], edges: [] };
}

/** Starter loops the user can drop in and edit. */
export function automationTemplates(): Array<{ id: string; name: string; description: string; flow: AutomationFlow }> {
  const bugTrigger = newNode("trigger", 40, 160, { kind: "work_item_created", itemTypes: ["BUG"] });
  const bugSupervisor = newNode("supervisor", 40, 320, { notifyOn: ["start", "fail", "done"] });
  const bugAgent = newNode("agent", 320, 160, {
    prompt:
      "Reproduce the bug in the Azure sandbox, find the root cause, and fix it with the smallest safe change. Add or update a regression test.",
    autoMode: true,
  });
  const bugTest = newNode("test", 600, 160, { command: "npm test -- --run", maxRetries: 2 });
  const bugDeploy = newNode("deploy", 880, 160, { mode: "open_pr" });
  const bugNotify = newNode("notify", 1160, 160, {
    channel: "slack",
    message: "Fairlx fixed {{key}} — {{title}}. Tests pass and the PR is open: {{prUrl}}",
  });
  const bugClose = newNode("close", 1160, 320, { status: "IN_REVIEW", comment: "PR opened by Fairlx automation." });

  const readyTrigger = newNode("trigger", 40, 160, { kind: "work_item_status", statuses: ["READY", "TODO"], itemTypes: ["STORY", "TASK"] });
  const readyAgent = newNode("agent", 320, 160, {
    prompt: "Implement this story end to end in the Azure sandbox. Keep the existing app working; add the feature behind the current UI.",
    autoMode: true,
  });
  const readyTest = newNode("test", 600, 160, { command: "npm test -- --run", maxRetries: 1 });
  const readyDeploy = newNode("deploy", 880, 160, { mode: "open_pr" });
  const readySup = newNode("supervisor", 600, 320, { notifyOn: ["start", "done", "fail"], requireApproval: true });

  const chatTrigger = newNode("trigger", 40, 160, { kind: "chat_mention" });
  const chatAgent = newNode("agent", 320, 160, {
    prompt: "Do exactly what the Slack thread asks on the linked work item. If it is a bug, fix it; if it is a feature, implement it.",
    autoMode: true,
  });
  const chatTest = newNode("test", 600, 160, { command: "npm test -- --run", maxRetries: 2 });
  const chatNotify = newNode("notify", 880, 160, { channel: "slack", message: "Done: {{key}} {{title}} — {{summary}}" });

  return [
    {
      id: "bug-fix-loop",
      name: "Bug → fix → test → PR",
      description: "When a BUG is raised, Fairlx reproduces it, fixes it, loops on failing tests, opens a PR, then tells the channel and the supervisor.",
      flow: {
        version: 1,
        nodes: [bugTrigger, bugSupervisor, bugAgent, bugTest, bugDeploy, bugNotify, bugClose],
        edges: [
          newEdge(bugTrigger.id, bugAgent.id),
          newEdge(bugAgent.id, bugTest.id),
          newEdge(bugTest.id, bugDeploy.id, "pass"),
          newEdge(bugTest.id, bugAgent.id, "fail"),
          newEdge(bugDeploy.id, bugNotify.id),
          newEdge(bugDeploy.id, bugClose.id),
          newEdge(bugSupervisor.id, bugAgent.id),
        ],
      },
    },
    {
      id: "story-build",
      name: "Ready story → build → PR (supervisor approves)",
      description: "When a story reaches Ready, Fairlx builds it, runs tests, and opens a PR. The supervisor is pinged and must approve the merge.",
      flow: {
        version: 1,
        nodes: [readyTrigger, readyAgent, readyTest, readyDeploy, readySup],
        edges: [
          newEdge(readyTrigger.id, readyAgent.id),
          newEdge(readyAgent.id, readyTest.id),
          newEdge(readyTest.id, readyDeploy.id, "pass"),
          newEdge(readyTest.id, readyAgent.id, "fail"),
          newEdge(readySup.id, readyDeploy.id),
        ],
      },
    },
    {
      id: "slack-thread",
      name: "Slack reply “@Fairlx …” → do it",
      description: "Reply @Fairlx in a Slack thread that mentions a work item (or under a Fairlx-posted item). Fairlx executes, tests, and replies in the thread.",
      flow: {
        version: 1,
        nodes: [chatTrigger, chatAgent, chatTest, chatNotify],
        edges: [
          newEdge(chatTrigger.id, chatAgent.id),
          newEdge(chatAgent.id, chatTest.id),
          newEdge(chatTest.id, chatNotify.id, "pass"),
          newEdge(chatTest.id, chatAgent.id, "fail"),
        ],
      },
    },
  ];
}

export function triggerNode(flow?: AutomationFlow | null): AutomationNode | null {
  return flow?.nodes.find((node) => node.kind === "trigger") ?? null;
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim().toUpperCase()).filter(Boolean);
  if (typeof value === "string") return value.split(/[,\s]+/).map((item) => item.trim().toUpperCase()).filter(Boolean);
  return [];
}

export function validateFlow(flow?: AutomationFlow | null): string[] {
  const problems: string[] = [];
  if (!flow || !flow.nodes.length) return ["Add a trigger node to start the loop."];
  const triggers = flow.nodes.filter((node) => node.kind === "trigger");
  if (triggers.length === 0) problems.push("The loop needs exactly one trigger node.");
  if (triggers.length > 1) problems.push("Only one trigger node is allowed.");
  const ids = new Set(flow.nodes.map((node) => node.id));
  for (const edge of flow.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) problems.push("An edge points at a node that no longer exists.");
  }
  const trigger = triggers[0];
  if (trigger && !flow.edges.some((edge) => edge.from === trigger.id)) {
    problems.push("Connect the trigger to an agent, notify, or supervisor node.");
  }
  if (!flow.nodes.some((node) => node.kind === "agent" || node.kind === "notify" || node.kind === "close")) {
    problems.push("Add at least one action node (agent, notify, or close).");
  }
  return Array.from(new Set(problems));
}

/** Does this event fire this automation? */
export function automationMatchesEvent(automation: AgentAutomation, event: AutomationEvent): boolean {
  if (!automation.enabled) return false;
  const trigger = triggerNode(automation.flow);
  if (!trigger) return false;
  const kind = String(trigger.config.kind || "manual") as AutomationTriggerKind;
  if (kind === "manual" || kind !== event.kind) return false;
  if (automation.workspaceId && event.workspaceId && automation.workspaceId !== event.workspaceId) return false;
  if (automation.projectId && event.projectId && automation.projectId !== event.projectId) return false;
  const item = event.workItem;
  const types = asList(trigger.config.itemTypes);
  if (types.length && item?.type && !types.includes(String(item.type).toUpperCase())) return false;
  const priorities = asList(trigger.config.priorities);
  if (priorities.length && item?.priority && !priorities.includes(String(item.priority).toUpperCase())) return false;
  const statuses = asList(trigger.config.statuses);
  if (kind === "work_item_status" && statuses.length) {
    if (!item?.status || !statuses.includes(String(item.status).toUpperCase())) return false;
  }
  const keyword = String(trigger.config.keyword || "").trim().toLowerCase();
  if (keyword) {
    const haystack = `${item?.title || ""} ${item?.description || ""} ${event.text || ""}`.toLowerCase();
    if (!haystack.includes(keyword)) return false;
  }
  return true;
}

function fill(template: string, event: AutomationEvent): string {
  const item = event.workItem;
  return template
    .replace(/\{\{\s*key\s*\}\}/g, item?.key || item?.id || "")
    .replace(/\{\{\s*title\s*\}\}/g, item?.title || "")
    .replace(/\{\{\s*type\s*\}\}/g, item?.type || "")
    .replace(/\{\{\s*status\s*\}\}/g, item?.status || "")
    .replace(/\{\{\s*text\s*\}\}/g, event.text || "");
}

type Step = { node: AutomationNode; depth: number };

/** Walk pass/always edges from the trigger; return nodes in execution order (no repeats). */
export function orderedSteps(flow: AutomationFlow): Step[] {
  const trigger = triggerNode(flow);
  if (!trigger) return [];
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>([trigger.id]);
  const out: Step[] = [];
  const queue: Step[] = [{ node: trigger, depth: 0 }];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of flow.edges) {
      if (edge.from !== current.node.id) continue;
      if (edge.when === "fail") continue;
      const next = byId.get(edge.to);
      if (!next || seen.has(next.id)) continue;
      seen.add(next.id);
      out.push({ node: next, depth: current.depth + 1 });
      queue.push({ node: next, depth: current.depth + 1 });
    }
  }
  // Supervisor nodes can be attached anywhere; make sure they appear even if only they point in.
  for (const node of flow.nodes) {
    if (node.kind === "supervisor" && !seen.has(node.id)) out.unshift({ node, depth: 0 });
  }
  return out;
}

export function failLoops(flow: AutomationFlow): Array<{ from: AutomationNode; to: AutomationNode }> {
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  return flow.edges
    .filter((edge) => edge.when === "fail")
    .map((edge) => ({ from: byId.get(edge.from)!, to: byId.get(edge.to)! }))
    .filter((pair) => pair.from && pair.to);
}

export function supervisorNodes(flow?: AutomationFlow | null): AutomationNode[] {
  return flow?.nodes.filter((node) => node.kind === "supervisor") ?? [];
}

/**
 * Turn the graph into the single prompt an autonomous run executes. The runtime already has
 * coding_session_start / implement / exec, github_open_pr, notify-style tools and the plan
 * gate, so we describe the loop precisely and let the agent execute it.
 */
export function compileAutomationPrompt(automation: AgentAutomation, event: AutomationEvent): string {
  const flow = automation.flow ?? emptyFlow();
  const item = event.workItem;
  const steps = orderedSteps(flow);
  const loops = failLoops(flow);
  const lines: string[] = [];
  lines.push(`Automation "${automation.name}" fired (${event.kind}${event.source ? ` via ${event.source}` : ""}).`);
  if (item) {
    lines.push(
      `Work item: ${item.key || item.id} — ${item.title || "(untitled)"}${item.type ? ` [${item.type}]` : ""}${item.priority ? ` priority ${item.priority}` : ""}${item.status ? ` status ${item.status}` : ""}.`,
    );
    if (item.description) lines.push(`Description:\n${item.description.slice(0, 1500)}`);
  }
  if (event.text) lines.push(`Request text: ${event.text.slice(0, 800)}`);
  lines.push("");
  lines.push("Execute this loop autonomously (all_access). Do not ask questions; do not stop after planning.");
  let index = 1;
  for (const { node } of steps) {
    const cfg = node.config;
    switch (node.kind) {
      case "agent":
        lines.push(
          `${index++}. AGENT: ${fill(String(cfg.prompt || "Do the work described by the work item."), event)} Submit a short implementation plan, call coding_session_start, then coding_session_implement in the Azure sandbox. Edit the existing repo; do not scaffold a new app.`,
        );
        break;
      case "test": {
        const retries = Number(cfg.maxRetries ?? 2);
        lines.push(
          `${index++}. TEST: run \`${String(cfg.command || "npm test")}\` with coding_session_exec in /workspace. Paste the failing test names in chat. If tests fail, go back to the AGENT step and fix — at most ${retries} more time${retries === 1 ? "" : "s"}. If still failing, stop and report what is broken.`,
        );
        break;
      }
      case "deploy": {
        const mode = String(cfg.mode || "open_pr");
        const custom = String(cfg.command || "").trim();
        if (custom) {
          lines.push(`${index++}. DEPLOY: run \`${custom}\` with coding_session_exec and confirm it exits 0.`);
        } else if (mode === "merge_pr") {
          lines.push(`${index++}. DEPLOY: push the sandbox branch, open the PR with github_open_pr, then merge it with github_merge_pr once checks pass.`);
        } else if (mode === "push_branch") {
          lines.push(`${index++}. DEPLOY: push the sandbox branch fairlx/{key} so the preview and CI pick it up. Do not open a PR.`);
        } else {
          lines.push(`${index++}. DEPLOY: push the sandbox branch and open a pull request with github_open_pr. Put the test results and a 3-line summary in the PR body.`);
        }
        break;
      }
      case "notify": {
        const channel = String(cfg.channel || "slack");
        const target = String(cfg.target || "").trim();
        lines.push(
          `${index++}. NOTIFY (${channel}${target ? ` → ${target}` : ""}): post "${fill(String(cfg.message || "Fairlx finished {{key}}."), event)}" with the PR link and a one-line test summary via notify_channel (channel "${channel}"${target ? `, target "${target}"` : ""}); if it is not connected, say so in chat instead of failing.`,
        );
        break;
      }
      case "close": {
        const status = String(cfg.status || "DONE");
        lines.push(
          `${index++}. CLOSE: set the work item status to ${status} with fairlx_work_item_update and add the comment "${fill(String(cfg.comment || "Done by Fairlx."), event)}" with fairlx_comment_add.`,
        );
        break;
      }
      case "supervisor": {
        const target = String(cfg.target || "").trim() || "the person who raised the item";
        const on = asList(cfg.notifyOn).map((entry) => entry.toLowerCase());
        const approval = cfg.requireApproval === true;
        const channel = String(cfg.channel || "in_app");
        lines.push(
          `SUPERVISOR: keep ${target} informed${on.length ? ` on ${on.join(", ")}` : ""}. Send a short update with notify_channel (channel "${channel}"${cfg.target ? `, target "${String(cfg.target)}"` : ""}) when tests fail and when you finish.${approval ? " Do NOT merge or close without their approval — open the PR, then stop and ask them to approve." : ""}`,
        );
        break;
      }
      default:
        break;
    }
  }
  if (loops.length) {
    lines.push("");
    lines.push(
      `Loops: ${loops
        .map((pair) => `${nodeTitle(pair.from.kind)} fails → back to ${nodeTitle(pair.to.kind)}`)
        .join("; ")}. Respect the retry limits above.`,
    );
  }
  lines.push("");
  lines.push(
    "Finish with a chat summary: what changed (files), test result, PR/preview links, and anything the supervisor must decide.",
  );
  return lines.join("\n");
}

export function describeAutomation(automation: AgentAutomation): string {
  const trigger = triggerNode(automation.flow);
  if (!trigger) return automation.trigger || automation.description || "";
  const kind = AUTOMATION_TRIGGER_KINDS.find((entry) => entry.id === String(trigger.config.kind))?.label || String(trigger.config.kind);
  const types = asList(trigger.config.itemTypes);
  const steps = orderedSteps(automation.flow!).map(({ node }) => nodeTitle(node.kind));
  return `${kind}${types.length ? ` (${types.join(", ")})` : ""} → ${steps.join(" → ") || "no steps"}`;
}

/** Keep the JSON small for the 16KB harness column. */
export function compactFlow(flow: AutomationFlow): AutomationFlow {
  return {
    version: 1,
    nodes: flow.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      ...(node.label ? { label: node.label.slice(0, 60) } : {}),
      x: Math.round(node.x),
      y: Math.round(node.y),
      config: Object.fromEntries(
        Object.entries(node.config).filter(([, value]) => {
          if (Array.isArray(value)) return value.length > 0;
          if (typeof value === "string") return value.trim().length > 0;
          return value !== undefined && value !== null;
        }),
      ) as AutomationNode["config"],
    })),
    edges: flow.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      ...(edge.when && edge.when !== "always" ? { when: edge.when } : {}),
    })),
  };
}
