import { ID, Query, type Databases } from "node-appwrite";

import { COMMENTS_ID, DATABASE_ID, WORK_ITEMS_ID } from "@/config";
import { generateWorkItemKey } from "@/features/sprints/lib/generate-work-item-key";
import { getAppBaseUrl } from "@/features/integrations/lib/helpers";

import { extractWorkItemKey, parseFairlxMention } from "../lib/mentions";
import { handleInboundFairlxMention } from "../lib/inbound-mentions";
import { findActiveCodingSessionForWorkItem, listCodingSessionsForProject } from "../lib/coding-sessions";
import { getOrCreateHarness } from "../lib/harness";
import { listRuns } from "../lib/runs";
import { describeAutomation } from "../lib/automation-flow";
import { dispatchAutomationEvent, fireAutomation, workItemAutomationEvent } from "../lib/automation-runner";
import { fetchSlackThread, plainSlackText, type SlackIntegration } from "./slack";

/**
 * `/fairlx …` slash commands and `@Fairlx` thread replies. Everything routes through the same
 * project the Slack workspace is linked to (project_integrations.provider = slack).
 */

export type SlackCommandInput = {
  databases: Databases;
  slack: SlackIntegration;
  text: string;
  slackUserId?: string;
  slackUserName?: string;
  channelId?: string;
  /** Fairlx user id that owns the linked integration; runs and items are attributed to them. */
  actorUserId: string;
  actorEmail?: string;
};

export type SlackCommandReply = { text: string; inChannel?: boolean };

const TYPE_ALIASES: Record<string, string> = {
  bug: "BUG",
  issue: "ISSUE",
  story: "STORY",
  task: "TASK",
  epic: "EPIC",
  create: "TASK",
  new: "TASK",
  add: "TASK",
};

const CLOSED_STATUSES = new Set(["DONE", "CLOSED", "RESOLVED", "CANCELLED", "CANCELED"]);

export const SLACK_COMMAND_HELP = [
  "*Fairlx Slack commands*",
  "`/fairlx bug <title>` · `/fairlx issue <title>` · `/fairlx story <title>` · `/fairlx task <title>` — raise a work item (add `p1`/`p2`/`high`/`urgent` anywhere for priority)",
  "`/fairlx create <title>` — same as task",
  "`/fairlx fix <KEY> [what to do]` — Fairlx agent fixes/implements it in the sandbox (autonomous)",
  "`/fairlx build <title or KEY>` — raise a story and have Fairlx build it right away",
  "`/fairlx close <KEY> [comment]` · `/fairlx reopen <KEY>`",
  "`/fairlx status <KEY> [NEW_STATUS]` — show or change status",
  "`/fairlx assign <KEY> fairlx|me`",
  "`/fairlx comment <KEY> <text>`",
  "`/fairlx show <KEY>` · `/fairlx list [open|done|bugs|mine|<STATUS>]`",
  "`/fairlx sessions` — live coding sessions (preview + PR links) · `/fairlx preview <KEY>` · `/fairlx pr <KEY>`",
  "`/fairlx runs` — recent agent runs · `/fairlx automations` · `/fairlx run <automation name> [KEY]`",
  "`/fairlx link` — which Fairlx project this Slack workspace controls",
  "",
  "Reply *@Fairlx …* in any thread that mentions a key (or under a message Fairlx posted) and the agent executes it. `@Fairlx-auto` skips every Accept.",
].join("\n");

function itemUrl(item: { $id: string; workspaceId?: string }): string {
  return `${getAppBaseUrl()}/workspaces/${item.workspaceId || ""}/tasks/${item.$id}`;
}

function runUrl(runId: string): string {
  return `${getAppBaseUrl()}/agent/workflow?runId=${runId}`;
}

type Item = Record<string, unknown> & { $id: string; key?: string; title?: string; status?: string; type?: string; priority?: string; workspaceId?: string; projectId?: string; assigneeIds?: string[] };

function fmt(item: Item): string {
  return `*${item.key || item.$id}* ${item.title || ""} — ${String(item.type || "TASK").toLowerCase()}, ${item.status || "TODO"}${item.priority ? `, ${String(item.priority).toLowerCase()}` : ""}`;
}

export function parsePriority(text: string): { priority: string; rest: string } {
  const patterns: Array<[RegExp, string]> = [
    [/\b(p0|p1|urgent|critical|blocker)\b/i, "URGENT"],
    [/\b(p2|high)\b/i, "HIGH"],
    [/\b(p3|medium|normal)\b/i, "MEDIUM"],
    [/\b(p4|low|minor)\b/i, "LOW"],
  ];
  for (const [re, priority] of patterns) {
    if (re.test(text)) return { priority, rest: text.replace(re, "").replace(/\s{2,}/g, " ").trim() };
  }
  return { priority: "MEDIUM", rest: text.trim() };
}

export async function findItemByKey(databases: Databases, projectId: string, key: string): Promise<Item | null> {
  if (!key) return null;
  try {
    const listed = await databases.listDocuments(DATABASE_ID, WORK_ITEMS_ID, [
      Query.equal("projectId", projectId),
      Query.equal("key", key.toUpperCase()),
      Query.limit(1),
    ]);
    return (listed.documents[0] as unknown as Item) ?? null;
  } catch {
    return null;
  }
}

export async function createItemFromSlack(params: {
  databases: Databases;
  slack: SlackIntegration;
  title: string;
  type: string;
  priority?: string;
  description?: string;
  actorUserId: string;
  actorName?: string;
}): Promise<Item> {
  const { databases, slack } = params;
  const key = await generateWorkItemKey(databases, slack.projectId);
  const doc = await databases.createDocument(DATABASE_ID, WORK_ITEMS_ID, ID.unique(), {
    workspaceId: slack.workspaceId,
    projectId: slack.projectId,
    title: params.title.slice(0, 200),
    key,
    type: params.type,
    status: "TODO",
    priority: params.priority || "MEDIUM",
    assigneeIds: [],
    reporterId: params.actorUserId,
    description: params.description || "",
    position: Date.now(),
  });
  const item = doc as unknown as Item;
  void dispatchAutomationEvent(
    databases,
    workItemAutomationEvent("work_item_created", item, {
      source: "slack",
      actor: { id: params.actorUserId, name: params.actorName },
    }),
  );
  return item;
}

async function addComment(databases: Databases, item: Item, authorId: string, content: string): Promise<void> {
  if (!COMMENTS_ID) return;
  try {
    await databases.createDocument(DATABASE_ID, COMMENTS_ID, ID.unique(), {
      content,
      taskId: item.$id,
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      authorId,
      isEdited: false,
    });
  } catch {
    /* comments are optional for Slack flows */
  }
}

async function startAgentOnItem(params: {
  databases: Databases;
  slack: SlackIntegration;
  item: Item;
  instructions: string;
  actorUserId: string;
  actorName?: string;
  auto?: boolean;
}): Promise<{ runId?: string; error?: string }> {
  const mention = params.auto === false ? "@Fairlx" : "@Fairlx-auto";
  const text = `${mention} ${params.item.key || ""} ${params.instructions || "Fix or implement this work item."}`.trim();
  const result = await handleInboundFairlxMention({
    databases: params.databases,
    source: "slack",
    text,
    userId: params.actorUserId,
    projectId: params.slack.projectId,
    workspaceId: params.slack.workspaceId,
    workItemId: params.item.$id,
  });
  void dispatchAutomationEvent(
    params.databases,
    workItemAutomationEvent("chat_mention", params.item, {
      text: params.instructions,
      source: "slack",
      actor: { id: params.actorUserId, name: params.actorName },
    }),
  );
  return { runId: result.runId, error: result.ok ? undefined : result.error };
}

export async function handleSlackCommand(input: SlackCommandInput): Promise<SlackCommandReply> {
  const { databases, slack } = input;
  const raw = plainSlackText(input.text);
  const [verbRaw = "help", ...restParts] = raw.split(/\s+/);
  const verb = verbRaw.toLowerCase();
  const rest = restParts.join(" ").trim();
  const keyArg = extractWorkItemKey(rest) || (restParts[0] || "").toUpperCase();
  const afterKey = rest.replace(new RegExp(`^${keyArg}\\b`, "i"), "").trim();

  if (verb === "help" || verb === "" || verb === "?") return { text: SLACK_COMMAND_HELP };

  if (verb === "link") {
    return {
      text: `This Slack workspace controls Fairlx project \`${slack.projectId}\` (workspace \`${slack.workspaceId}\`). Default channel: ${slack.channelId ? `<#${slack.channelId}>` : "not set"}.`,
    };
  }

  if (verb in TYPE_ALIASES) {
    if (!rest) return { text: `Usage: \`/fairlx ${verb} <title>\`` };
    const { priority, rest: title } = parsePriority(rest);
    const item = await createItemFromSlack({
      databases,
      slack,
      title,
      type: TYPE_ALIASES[verb],
      priority,
      actorUserId: input.actorUserId,
      actorName: input.slackUserName,
      description: `Raised from Slack by ${input.slackUserName || input.slackUserId || "a teammate"}${input.channelId ? ` in <#${input.channelId}>` : ""}.`,
    });
    return {
      inChannel: true,
      text: `Created ${fmt(item)}\n${itemUrl(item)}\nReply \`@Fairlx fix it\` in this thread or run \`/fairlx fix ${item.key}\`.`,
    };
  }

  if (verb === "build") {
    if (!rest) return { text: "Usage: `/fairlx build <title or KEY> [details]`" };
    let item = await findItemByKey(databases, slack.projectId, extractWorkItemKey(rest) || "");
    let instructions = rest;
    if (!item) {
      const { priority, rest: title } = parsePriority(rest);
      item = await createItemFromSlack({
        databases,
        slack,
        title,
        type: "STORY",
        priority,
        actorUserId: input.actorUserId,
        actorName: input.slackUserName,
      });
      instructions = `Implement: ${title}`;
    } else {
      instructions = afterKey || `Implement ${item.key}: ${item.title || ""}`;
    }
    const started = await startAgentOnItem({ databases, slack, item, instructions, actorUserId: input.actorUserId, actorName: input.slackUserName });
    if (started.error && !started.runId) return { text: `${fmt(item)}\nCould not start Fairlx: ${started.error}` };
    return {
      inChannel: true,
      text: `Fairlx is building ${fmt(item)}\n${started.runId ? runUrl(started.runId) : itemUrl(item)}`,
    };
  }

  if (verb === "fix" || verb === "implement" || verb === "do" || verb === "start") {
    const item = await findItemByKey(databases, slack.projectId, extractWorkItemKey(rest) || "");
    if (!item) return { text: `Usage: \`/fairlx fix <KEY> [instructions]\` — I could not find a work item key in "${rest}".` };
    const started = await startAgentOnItem({
      databases,
      slack,
      item,
      instructions: afterKey || `Fix ${item.key}: ${item.title || ""}`,
      actorUserId: input.actorUserId,
      actorName: input.slackUserName,
    });
    if (started.error && !started.runId) return { text: `${fmt(item)}\nCould not start Fairlx: ${started.error}` };
    return { inChannel: true, text: `Fairlx is on ${fmt(item)}\n${started.runId ? runUrl(started.runId) : itemUrl(item)}` };
  }

  if (verb === "close" || verb === "done" || verb === "resolve") {
    const item = await findItemByKey(databases, slack.projectId, keyArg);
    if (!item) return { text: `Usage: \`/fairlx close <KEY> [comment]\`` };
    await databases.updateDocument(DATABASE_ID, WORK_ITEMS_ID, item.$id, { status: "DONE" });
    if (afterKey) await addComment(databases, item, input.actorUserId, afterKey);
    return { inChannel: true, text: `Closed *${item.key}* ${item.title || ""}${afterKey ? ` — "${afterKey}"` : ""}` };
  }

  if (verb === "reopen") {
    const item = await findItemByKey(databases, slack.projectId, keyArg);
    if (!item) return { text: `Usage: \`/fairlx reopen <KEY>\`` };
    await databases.updateDocument(DATABASE_ID, WORK_ITEMS_ID, item.$id, { status: "TODO" });
    return { inChannel: true, text: `Reopened *${item.key}* ${item.title || ""}` };
  }

  if (verb === "status" || verb === "move") {
    const item = await findItemByKey(databases, slack.projectId, keyArg);
    if (!item) return { text: `Usage: \`/fairlx status <KEY> [NEW_STATUS]\`` };
    if (!afterKey) return { text: `${fmt(item)}\n${itemUrl(item)}` };
    const next = afterKey.toUpperCase().replace(/\s+/g, "_");
    await databases.updateDocument(DATABASE_ID, WORK_ITEMS_ID, item.$id, { status: next });
    void dispatchAutomationEvent(
      databases,
      workItemAutomationEvent("work_item_status", { ...item, status: next }, { source: "slack", actor: { id: input.actorUserId, name: input.slackUserName } }),
    );
    return { inChannel: true, text: `*${item.key}* → ${next}` };
  }

  if (verb === "assign") {
    const item = await findItemByKey(databases, slack.projectId, keyArg);
    if (!item) return { text: `Usage: \`/fairlx assign <KEY> fairlx|me\`` };
    const who = afterKey.toLowerCase();
    if (who.includes("fairlx") || who.includes("agent") || who.includes("bot")) {
      const started = await startAgentOnItem({
        databases,
        slack,
        item,
        instructions: `Fix or implement ${item.key}: ${item.title || ""}`,
        actorUserId: input.actorUserId,
        actorName: input.slackUserName,
        auto: false,
      });
      return { inChannel: true, text: `Assigned *${item.key}* to Fairlx.${started.runId ? ` ${runUrl(started.runId)}` : ""}` };
    }
    const assignees = new Set<string>(Array.isArray(item.assigneeIds) ? item.assigneeIds : []);
    assignees.add(input.actorUserId);
    await databases.updateDocument(DATABASE_ID, WORK_ITEMS_ID, item.$id, { assigneeIds: Array.from(assignees) });
    return { inChannel: true, text: `Assigned *${item.key}* to you.` };
  }

  if (verb === "comment" || verb === "note") {
    const item = await findItemByKey(databases, slack.projectId, keyArg);
    if (!item || !afterKey) return { text: `Usage: \`/fairlx comment <KEY> <text>\`` };
    await addComment(databases, item, input.actorUserId, `${afterKey}\n\n_(from Slack${input.slackUserName ? ` · ${input.slackUserName}` : ""})_`);
    if (parseFairlxMention(afterKey)) {
      await startAgentOnItem({ databases, slack, item, instructions: afterKey, actorUserId: input.actorUserId, actorName: input.slackUserName, auto: parseFairlxMention(afterKey) === "fairlx-auto" });
    }
    return { text: `Comment added to *${item.key}*.` };
  }

  if (verb === "show" || verb === "get" || verb === "info") {
    const item = await findItemByKey(databases, slack.projectId, keyArg);
    if (!item) return { text: `No work item ${keyArg} in the linked project.` };
    const session = await findActiveCodingSessionForWorkItem(databases, item.$id);
    const lines = [fmt(item), itemUrl(item)];
    if (item.description) lines.push(String(item.description).slice(0, 400));
    if (session) {
      lines.push(`Session: ${session.status}${session.previewUrl ? ` · preview ${session.previewUrl}` : ""}${session.prUrl ? ` · PR ${session.prUrl}` : ""}${session.runId ? ` · ${runUrl(session.runId)}` : ""}`);
    }
    return { text: lines.join("\n") };
  }

  if (verb === "list" || verb === "ls" || verb === "open" || verb === "bugs" || verb === "mine") {
    const filter = (verb === "list" || verb === "ls" ? rest : verb).toLowerCase();
    const queries = [Query.equal("projectId", slack.projectId), Query.orderDesc("$createdAt"), Query.limit(25)];
    if (filter === "bugs" || filter === "bug") queries.push(Query.equal("type", "BUG"));
    if (filter === "mine") queries.push(Query.contains("assigneeIds", [input.actorUserId]));
    let docs: Item[] = [];
    try {
      docs = (await databases.listDocuments(DATABASE_ID, WORK_ITEMS_ID, queries)).documents as unknown as Item[];
    } catch {
      docs = (await databases.listDocuments(DATABASE_ID, WORK_ITEMS_ID, [Query.equal("projectId", slack.projectId), Query.limit(25)])).documents as unknown as Item[];
    }
    let rows = docs;
    if (filter === "" || filter === "open") rows = docs.filter((item) => !CLOSED_STATUSES.has(String(item.status || "").toUpperCase()));
    else if (filter === "done" || filter === "closed") rows = docs.filter((item) => CLOSED_STATUSES.has(String(item.status || "").toUpperCase()));
    else if (filter !== "bugs" && filter !== "bug" && filter !== "mine") rows = docs.filter((item) => String(item.status || "").toUpperCase() === filter.toUpperCase());
    rows = rows.slice(0, 10);
    if (!rows.length) return { text: `No work items match \`${filter || "open"}\`.` };
    return { text: [`*${rows.length} item${rows.length === 1 ? "" : "s"}* (${filter || "open"})`, ...rows.map((item) => `• ${fmt(item)}`)].join("\n") };
  }

  if (verb === "sessions" || verb === "monitor" || verb === "watch") {
    const sessions = await listCodingSessionsForProject(databases, slack.projectId, 10);
    if (!sessions.length) return { text: "No coding sessions for the linked project yet. Try `/fairlx fix <KEY>`." };
    return {
      text: [
        "*Coding sessions*",
        ...sessions.map(
          (session) =>
            `• ${session.status} · item ${session.workItemId}${session.previewUrl ? ` · <${session.previewUrl}|preview>` : ""}${session.prUrl ? ` · <${session.prUrl}|PR>` : ""}${session.runId ? ` · <${runUrl(session.runId)}|run>` : ""}`,
        ),
      ].join("\n"),
    };
  }

  if (verb === "preview" || verb === "pr") {
    const item = await findItemByKey(databases, slack.projectId, keyArg);
    if (!item) return { text: `Usage: \`/fairlx ${verb} <KEY>\`` };
    const session = await findActiveCodingSessionForWorkItem(databases, item.$id);
    if (!session) return { text: `No active coding session for *${item.key}*. Start one with \`/fairlx fix ${item.key}\`.` };
    if (verb === "pr") return { text: session.prUrl ? `PR for *${item.key}*: ${session.prUrl}` : `No PR yet for *${item.key}* (session ${session.status}).` };
    return { text: session.previewUrl ? `Preview for *${item.key}*: ${session.previewUrl}` : `No live preview yet for *${item.key}* (session ${session.status}).` };
  }

  if (verb === "runs") {
    const runs = await listRuns(databases, input.actorUserId, 8);
    if (!runs.length) return { text: "No agent runs yet." };
    return {
      text: ["*Recent agent runs*", ...runs.map((run) => `• ${run.status} · ${run.title} · <${runUrl(run.id)}|open>`)].join("\n"),
    };
  }

  if (verb === "automations" || verb === "loops") {
    const harness = await getOrCreateHarness(databases, input.actorUserId);
    if (!harness.automations.length) return { text: "No automations yet. Build one at /agent/automations." };
    return {
      text: [
        "*Automations*",
        ...harness.automations.map((automation) => `• ${automation.enabled ? "🟢" : "⚪"} *${automation.name}* — ${describeAutomation(automation)}${automation.runCount ? ` (${automation.runCount} runs)` : ""}`),
      ].join("\n"),
    };
  }

  if (verb === "run") {
    const harness = await getOrCreateHarness(databases, input.actorUserId);
    const key = extractWorkItemKey(rest);
    const name = rest.replace(key || "", "").trim().toLowerCase();
    const automation = harness.automations.find((entry) => entry.name.toLowerCase() === name) ?? harness.automations.find((entry) => entry.name.toLowerCase().includes(name));
    if (!automation) return { text: `No automation named "${name}". Try \`/fairlx automations\`.` };
    const item = key ? await findItemByKey(databases, slack.projectId, key) : null;
    const result = await fireAutomation(
      databases,
      { harness, automation },
      {
        kind: "manual",
        workspaceId: slack.workspaceId,
        projectId: slack.projectId,
        source: "slack",
        actor: { id: input.actorUserId, name: input.slackUserName },
        ...(item ? { workItem: { id: item.$id, key: item.key, title: item.title, type: item.type, status: item.status, priority: item.priority } } : {}),
      },
      { force: true },
    );
    return { inChannel: true, text: `Running *${automation.name}*${item ? ` on ${item.key}` : ""}.${result.runId ? ` ${runUrl(result.runId)}` : ""}` };
  }

  return { text: `Unknown command \`${verb}\`.\n${SLACK_COMMAND_HELP}` };
}

/**
 * A thread reply like "@Fairlx fix it". Resolve the work item from the text, the thread
 * (a key in any earlier message), or create one from the thread's parent message.
 */
export async function handleSlackThreadMention(params: {
  databases: Databases;
  slack: SlackIntegration;
  text: string;
  channel: string;
  threadTs?: string;
  messageTs: string;
  slackUserId?: string;
  slackUserName?: string;
  actorUserId: string;
  botUserId?: string;
}): Promise<{ text: string; item?: Item; runId?: string }> {
  const { databases, slack } = params;
  const mention = parseFairlxMention(params.text) || "fairlx";
  const auto = mention === "fairlx-auto";
  const clean = plainSlackText(params.text).replace(/@fairlx(?:-auto|_auto)?/gi, "").trim();
  let key = extractWorkItemKey(params.text);
  let thread: Awaited<ReturnType<typeof fetchSlackThread>> = [];
  if (!key && params.threadTs && slack.token) {
    thread = await fetchSlackThread({ token: slack.token, channel: params.channel, threadTs: params.threadTs });
    for (const message of thread) {
      const found = extractWorkItemKey(message.text);
      if (found) {
        key = found;
        break;
      }
    }
  }
  let item = key ? await findItemByKey(databases, slack.projectId, key) : null;
  if (!item) {
    const parent = thread.find((message) => message.ts === params.threadTs);
    const source = plainSlackText(parent?.text || "") || clean;
    if (!source) return { text: "Tell me what to do, e.g. `@Fairlx fix the login redirect` or include a key like WEB-12." };
    const looksLikeBug = /\b(bug|broken|error|crash|fail|doesn'?t work|not working|500|exception)\b/i.test(source);
    const { priority, rest: title } = parsePriority(source.split(/\n/)[0].slice(0, 140));
    item = await createItemFromSlack({
      databases,
      slack,
      title: title || source.slice(0, 120),
      type: looksLikeBug ? "BUG" : "STORY",
      priority,
      description: `${source}\n\n_(from Slack thread${params.slackUserName ? ` · ${params.slackUserName}` : ""})_`,
      actorUserId: params.actorUserId,
      actorName: params.slackUserName,
    });
  }
  const instructions = clean || `${item.type === "BUG" ? "Fix" : "Implement"} ${item.key}: ${item.title || ""}`;
  const started = await startAgentOnItem({
    databases,
    slack,
    item,
    instructions,
    actorUserId: params.actorUserId,
    actorName: params.slackUserName,
    auto,
  });
  const verb = auto ? "is executing autonomously" : "started";
  return {
    item,
    runId: started.runId,
    text: started.runId
      ? `Fairlx ${verb} on ${fmt(item)}\n${runUrl(started.runId)}`
      : `${fmt(item)}\n${started.error || "Fairlx queued the request."}`,
  };
}
