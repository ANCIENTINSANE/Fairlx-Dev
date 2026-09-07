import type { AgentContext, AgentHarness, AgentPluginConnection } from "../types";
import { DEEPSEEK_PRO_MODEL_ID, FOUNDRY_GPT_LUNA_MODEL_ID } from "../constants";
import { appendSessionEvent, createCodingSession, findActiveCodingSessionForWorkItem, updateCodingSession } from "./coding-sessions";
import { getSandboxDriver, redactSecrets } from "./sandbox";
import { resolveGithubRepo } from "../plugins/github";
import type { Databases } from "node-appwrite";

function workItemKey(context: AgentContext, workItemId: string): string {
  const item = context.workItems.find((entry) => entry.id === workItemId || entry.key === workItemId);
  return item?.key || workItemId.replace(/[^a-zA-Z0-9._/-]+/g, "-").slice(0, 40);
}

export async function startOrResumeCodingSession(params: {
  databases: Databases;
  userId: string;
  runId: string;
  context: AgentContext;
  harness: AgentHarness;
  plugins: AgentPluginConnection[];
  workItemId: string;
  projectId?: string;
  repoId?: string;
  baseBranch?: string;
  exposePort?: number;
  investigateOnly?: boolean;
}): Promise<Record<string, unknown>> {
  const item =
    params.context.workItems.find(
      (entry) => entry.id === params.workItemId || entry.key === params.workItemId,
    ) ?? null;
  const projectId = params.projectId || item?.projectId || params.context.projects[0]?.id || "";
  const workspaceId =
    item?.workspaceId ||
    params.context.projects.find((project) => project.id === projectId)?.workspaceId ||
    params.context.workspaces[0]?.id ||
    "";
  if (!projectId || !workspaceId) {
    return { error: "A project and workspace are required to start a coding session." };
  }

  const existing = await findActiveCodingSessionForWorkItem(params.databases, item?.id || params.workItemId);
  if (existing?.sandboxId) {
    return {
      sessionId: existing.id,
      status: existing.status,
      sandboxId: existing.sandboxId,
      previewUrl: existing.previewUrl,
      resumed: true,
      headBranch: existing.headBranch,
    };
  }

  const resolved = await resolveGithubRepo({
    databases: params.databases,
    context: params.context,
    plugins: params.plugins,
    repoId: params.repoId,
    projectId,
  });
  if ("error" in resolved) {
    return resolved;
  }

  const key = workItemKey(params.context, item?.id || params.workItemId);
  const headBranch = `fairlx/${key.toLowerCase()}`;
  const session =
    existing ??
    (await createCodingSession(params.databases, {
      userId: params.userId,
      workItemId: item?.id || params.workItemId,
      projectId,
      workspaceId,
      runId: params.runId,
      repoId: resolved.repoId,
      baseBranch: params.baseBranch || resolved.branch,
      headBranch,
      orchestratorModelId: params.harness.settings.sessionMode,
      workerModelId: DEEPSEEK_PRO_MODEL_ID,
    }));
  if (!session) {
    return { error: "Could not persist the coding session. Provision agent_coding_sessions." };
  }

  await updateCodingSession(params.databases, session.id, {
    status: "preparing",
    runId: params.runId,
    events: appendSessionEvent(session.events, "preparing", "Creating Azure sandbox"),
  });

  const driver = getSandboxDriver();
  const box = await driver.create({
    labels: { fairlxWorkItem: key, fairlxRun: params.runId },
  });
  const token = resolved.api.getAccessToken();
  const cloneUrl = `https://x-access-token:${token}@github.com/${resolved.owner}/${resolved.repo}.git`;
  const clone = await driver.exec(
    box.id,
    `git clone --depth 1 --branch ${params.baseBranch || resolved.branch} ${cloneUrl} /workspace`,
  );
  const branch = await driver.exec(box.id, `git checkout -b ${headBranch}`, "/workspace");
  let previewUrl: string | undefined;
  if (params.exposePort) {
    previewUrl = await driver.exposePort(box.id, params.exposePort);
  }

  const next = await updateCodingSession(params.databases, session.id, {
    status: params.investigateOnly ? "running" : "running",
    sandboxId: box.id,
    previewUrl,
    headBranch,
    runId: params.runId,
    repoId: resolved.repoId,
    workerModelId: DEEPSEEK_PRO_MODEL_ID,
    orchestratorModelId: FOUNDRY_GPT_LUNA_MODEL_ID,
    events: appendSessionEvent(
      appendSessionEvent(session.events, "clone", redactSecrets(clone.stdout || clone.stderr)),
      "branch",
      branch.stdout,
      { driver: driver.kind, sandboxId: box.id, previewUrl },
    ),
  });

  return {
    sessionId: session.id,
    status: next?.status ?? "running",
    sandboxId: box.id,
    previewUrl,
    headBranch,
    driver: driver.kind,
    owner: resolved.owner,
    repo: resolved.repo,
    investigateOnly: Boolean(params.investigateOnly),
    note:
      driver.kind === "stub"
        ? "Azure sandbox credentials are not set; commands are recorded on the stub driver and never run on the Fairlx host."
        : "Sandbox cloned the linked repo. Use coding_session_exec for tests and the preview URL when a port is exposed.",
  };
}

export async function pushCodingSessionBranch(params: {
  databases: Databases;
  sessionId: string;
  message?: string;
}): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const { getCodingSession } = await import("./coding-sessions");
  const session = await getCodingSession(params.databases, params.sessionId);
  if (!session?.sandboxId) return { ok: false, stdout: "", stderr: "No sandbox" };
  const driver = getSandboxDriver();
  const message = (params.message || "fairlx coding session").replace(/"/g, '\\"');
  const result = await driver.exec(
    session.sandboxId,
    `git add -A && git -c user.email=agent@fairlx.dev -c user.name="Fairlx Agent" commit -m "${message}" --allow-empty || true && git push -u origin HEAD`,
    "/workspace",
  );
  return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
}
