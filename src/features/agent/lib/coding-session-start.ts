import type { AgentContext, AgentHarness, AgentPluginConnection } from "../types";
import { DEEPSEEK_PRO_MODEL_ID, FOUNDRY_GPT_LUNA_MODEL_ID } from "../constants";
import {
  appendSessionEvent,
  createCodingSession,
  findActiveCodingSessionForWorkItem,
  findCodingSessionByRun,
  updateCodingSession,
  withSessionMeta,
} from "./coding-sessions";
import { getCodingEnvironment } from "./coding-environment";
import { loadProjectSecretValues, redactSecretMap } from "./project-secrets";
import { captureSandboxPreview } from "./sandbox-browser";
import { resolveSandboxCodingAgent } from "./sandbox-coding-agent";
import { prepareSandboxApp } from "./sandbox-prepare";
import { getSandboxDriver, redactSecrets, sandboxIsAlive } from "./sandbox";
import { azureSandboxFailureCode, isAzureSandboxAccessError } from "./sandbox/azure";
import {
  cloneIntoWorkspaceShell,
  createSandboxBranchShell,
  isSandboxGoneError,
  parseSandboxSourceMode,
  parseSandboxYes,
  sandboxHasSourceShell,
} from "./sandbox/workspace";
import { agentDebugLog } from "./sandbox/debug-log";
import { describeCodingPreview } from "./sandbox-preview";
import { resolveGithubRepo } from "../plugins/github";
import type { Databases } from "node-appwrite";
import type { CodingSessionMeta } from "../types";
import type { SandboxInfo } from "./sandbox";

function workItemKey(context: AgentContext, workItemId: string): string {
  const item = context.workItems.find((entry) => entry.id === workItemId || entry.key === workItemId);
  return item?.key || workItemId.replace(/[^a-zA-Z0-9._/-]+/g, "-").slice(0, 40);
}

function sandboxEnv(secrets: Record<string, string>, codingAgentEnv: Record<string, string>): Record<string, string> {
  return {
    ...secrets,
    ...codingAgentEnv,
    CI: "true",
    HOST: "0.0.0.0",
  };
}

async function finishPreview(params: {
  databases: Databases;
  sessionId: string;
  events: ReturnType<typeof appendSessionEvent>;
  sandboxId: string;
  exposePort: number;
  environment?: { prepareScript?: string; startCommand?: string };
  secrets: Record<string, string>;
  codingAgent: ReturnType<typeof resolveSandboxCodingAgent>;
  autoMode?: boolean;
}): Promise<{ previewUrl?: string; previewLive: boolean; driver: string; meta: CodingSessionMeta; events: ReturnType<typeof appendSessionEvent> }> {
  const driver = getSandboxDriver();
  const extraSecretValues = Object.values(params.secrets);
  let events = params.events;

  // Reserve the public URL before starting the app so dev servers with host checks (Vite
  // allowedHosts, Next allowedDevOrigins) can be told which hostname the proxy will send.
  let previewUrl: string | undefined;
  let previewHost: string | undefined;
  if (driver.kind === "azure" || driver.kind === "stub") {
    try {
      previewUrl = await driver.exposePort(params.sandboxId, params.exposePort);
      previewHost = new URL(previewUrl).hostname;
    } catch (error) {
      events = appendSessionEvent(
        events,
        "preview",
        error instanceof Error ? error.message : "Failed to expose preview port",
      );
    }
  }

  events = appendSessionEvent(events, "install", "Detecting toolchain and installing dependencies");
  const prepared = await prepareSandboxApp({
    driver,
    sandboxId: params.sandboxId,
    exposePort: params.exposePort,
    prepareScript: params.environment?.prepareScript,
    startCommand: params.environment?.startCommand,
    extraSecretValues,
    previewHost,
  });
  events = appendSessionEvent(
    events,
    "install",
    redactSecretMap(prepared.install.stdout || prepared.install.stderr, params.secrets).slice(0, 1500),
    {
      packageManager: prepared.detected.packageManager,
      startCommand: prepared.detected.startCommand,
      appDir: prepared.detected.appDir,
      exitCode: prepared.install.exitCode,
    },
  );
  events = appendSessionEvent(events, "dev_server", prepared.previewLive ? "Dev server healthy" : "Dev server start recorded", {
    startCommand: prepared.detected.startCommand,
    appDir: prepared.detected.appDir,
    previewLive: prepared.previewLive,
    health: prepared.health.stdout.slice(0, 800),
  });

  let previewLive = prepared.previewLive;
  if (driver.kind === "azure") {
    if (previewUrl && prepared.detected.port !== params.exposePort) {
      // The app pinned a different port in its own scripts; expose that one too.
      try {
        previewUrl = await driver.exposePort(params.sandboxId, prepared.detected.port);
      } catch (error) {
        events = appendSessionEvent(
          events,
          "preview",
          error instanceof Error ? error.message : "Failed to expose preview port",
        );
      }
    }
  } else {
    previewLive = false;
  }

  if (previewLive) {
    try {
      const shot = await captureSandboxPreview({ driver, sandboxId: params.sandboxId, port: prepared.detected.port });
      if (shot.artifacts.length) {
        events = appendSessionEvent(events, "screenshot", shot.log.slice(0, 400), { artifacts: shot.artifacts });
      }
    } catch {
      events = appendSessionEvent(events, "screenshot", "Sandbox browser screenshot skipped");
    }
  }

  const meta: CodingSessionMeta = {
    driver: driver.kind,
    previewLive,
    codingAgent: params.codingAgent.id,
    codingAgentReason: params.codingAgent.reason,
    exposePort: prepared.detected.port,
    startCommand: prepared.detected.startCommand,
    packageManager: prepared.detected.packageManager,
    autoMode: Boolean(params.autoMode),
    artifacts: events
      .flatMap((event) => {
        const payload = event.payload && typeof event.payload === "object" ? (event.payload as { artifacts?: CodingSessionMeta["artifacts"] }) : null;
        return payload?.artifacts ?? [];
      })
      .slice(-8),
  };
  events = withSessionMeta(events, meta);
  return { previewUrl, previewLive, driver: driver.kind, meta, events };
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
  autoMode?: boolean;
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

  const environment = await getCodingEnvironment(params.databases, projectId);
  const exposePort = params.exposePort && params.exposePort > 0 ? params.exposePort : environment?.exposePort || 3000;
  const secrets = await loadProjectSecretValues(params.databases, projectId);
  const codingAgent = resolveSandboxCodingAgent();
  const driver = getSandboxDriver();
  const autoMode = Boolean(params.autoMode || params.harness.settings.autonomousCoding || params.harness.settings.permissionType === "all_access");

  const existingByRun = params.runId ? await findCodingSessionByRun(params.databases, params.runId) : null;
  const existingWorkItem = await findActiveCodingSessionForWorkItem(params.databases, item?.id || params.workItemId);
  let existing =
    existingByRun?.sandboxId && existingByRun.status !== "merged" && existingByRun.status !== "stopped"
      ? existingByRun
      : existingWorkItem;
  let reuseSandboxId: string | undefined;

  if (existing?.sandboxId) {
    const alive = await sandboxIsAlive(driver, existing.sandboxId);
    if (!alive) {
      existing = {
        ...existing,
        sandboxId: undefined,
        previewUrl: undefined,
        previewLive: false,
        events: appendSessionEvent(
          existing.events,
          "preparing",
          "Previous Azure sandbox was deleted. Creating a new sandbox.",
        ),
      };
      await updateCodingSession(params.databases, existing.id, {
        sandboxId: "",
        previewUrl: "",
        previewLive: false,
        status: "preparing",
        events: existing.events,
      });
    } else {
      try {
        const checkout = await driver.exec(existing.sandboxId, sandboxHasSourceShell(), "/workspace");
        if (!parseSandboxYes(checkout.stdout)) {
          // The VM is up but the repo never landed (earlier clone failed). Reuse it and clone again.
          reuseSandboxId = existing.sandboxId;
        } else {
          const needsPrepare = existing.previewLive !== true;
          if (needsPrepare) {
            const finished = await finishPreview({
              databases: params.databases,
              sessionId: existing.id,
              events: existing.events,
              sandboxId: existing.sandboxId,
              exposePort,
              environment: environment ?? undefined,
              secrets,
              codingAgent,
              autoMode,
            });
            await updateCodingSession(params.databases, existing.id, {
              status: "running",
              previewUrl: finished.previewUrl,
              runId: params.runId,
              events: finished.events,
              meta: finished.meta,
              previewLive: finished.previewLive,
              driver: finished.driver as CodingSessionMeta["driver"],
              codingAgent: finished.meta.codingAgent,
              artifacts: finished.meta.artifacts,
            });
            const preview = describeCodingPreview({
              previewUrl: finished.previewUrl,
              driver: finished.driver,
              status: "running",
              sandboxId: existing.sandboxId,
              previewLive: finished.previewLive,
            });
            return {
              sessionId: existing.id,
              status: "running",
              sandboxId: existing.sandboxId,
              previewUrl: preview.live ? finished.previewUrl : undefined,
              previewLive: preview.live,
              previewStub: preview.stub,
              resumed: true,
              headBranch: existing.headBranch,
              driver: finished.driver,
              codingAgent: codingAgent.id,
              codingAgentReason: codingAgent.reason,
              note: preview.note,
            };
          }
          const preview = describeCodingPreview({
            previewUrl: existing.previewUrl,
            driver: existing.driver || driver.kind,
            status: existing.status,
            sandboxId: existing.sandboxId,
            previewLive: existing.previewLive,
          });
          return {
            sessionId: existing.id,
            status: existing.status,
            sandboxId: existing.sandboxId,
            previewUrl: preview.live ? existing.previewUrl : undefined,
            previewLive: preview.live,
            previewStub: preview.stub,
            resumed: true,
            headBranch: existing.headBranch,
            driver: preview.driver,
            codingAgent: existing.codingAgent,
            codingAgentReason: existing.codingAgentReason,
            note: preview.note,
          };
        }
      } catch (error) {
        if (!isSandboxGoneError(error)) {
          const message = error instanceof Error ? error.message : "Sandbox resume failed";
          return { error: message, retryable: !isAzureSandboxAccessError(message) };
        }
        existing = {
          ...existing,
          sandboxId: undefined,
          previewUrl: undefined,
          previewLive: false,
          events: appendSessionEvent(
            existing.events,
            "preparing",
            "Previous Azure sandbox was deleted. Creating a new sandbox.",
          ),
        };
        await updateCodingSession(params.databases, existing.id, {
          sandboxId: "",
          previewUrl: "",
          previewLive: false,
          status: "preparing",
          events: existing.events,
        });
      }
    }
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

  let box: SandboxInfo;
  if (reuseSandboxId) {
    box = { id: reuseSandboxId, driver: driver.kind };
    await updateCodingSession(params.databases, session.id, {
      status: "preparing",
      sandboxId: box.id,
      runId: params.runId,
      events: appendSessionEvent(session.events, "preparing", "Retrying clone into the existing Azure sandbox"),
      meta: { driver: driver.kind, previewLive: false, codingAgent: codingAgent.id, codingAgentReason: codingAgent.reason },
    });
  } else {
    await updateCodingSession(params.databases, session.id, {
      status: "preparing",
      runId: params.runId,
      events: appendSessionEvent(session.events, "preparing", "Creating Azure sandbox"),
      meta: { driver: driver.kind, previewLive: false, codingAgent: codingAgent.id, codingAgentReason: codingAgent.reason },
    });

    // #region agent log
    agentDebugLog({
      hypothesisId: "E",
      location: "coding-session-start.ts:beforeCreate",
      message: "about to create sandbox",
      data: { driverKind: driver.kind, repoId: resolved.repoId, headBranch },
      runId: "post-fix",
    });
    // #endregion
    try {
      box = await driver.create({
        labels: { fairlxWorkItem: key, fairlxRun: params.runId },
        env: sandboxEnv(secrets, codingAgent.env),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Azure sandbox create failed";
      // #region agent log
      agentDebugLog({
        hypothesisId: "A",
        location: "coding-session-start.ts:createCatch",
        message: "sandbox create failed",
        data: {
          aadsts: message.match(/AADSTS\d+/)?.[0] || null,
          is700016: /AADSTS700016/.test(message),
          retryable: !/AADSTS700016/.test(message),
        },
        runId: "post-fix",
      });
      // #endregion
      await updateCodingSession(params.databases, session.id, {
        status: "failed",
        events: appendSessionEvent(session.events, "error", message),
      });
      return {
        error: message,
        retryable: !isAzureSandboxAccessError(message),
        code: azureSandboxFailureCode(message) || undefined,
      };
    }
    await updateCodingSession(params.databases, session.id, {
      status: "preparing",
      sandboxId: box.id,
      events: appendSessionEvent(session.events, "preparing", "Created Azure sandbox, cloning into /workspace"),
    });
  }
  const token = resolved.api.getAccessToken();
  const cloneUrl = `https://x-access-token:${token}@github.com/${resolved.owner}/${resolved.repo}.git`;
  const cloneBranch = params.baseBranch || resolved.branch;
  let clone: { stdout: string; stderr: string; exitCode: number };
  let branch: { stdout: string; stderr: string; exitCode: number };
  try {
    clone = await driver.exec(box.id, cloneIntoWorkspaceShell(cloneUrl, cloneBranch));
    if (clone.exitCode !== 0) {
      const detail = redactSecrets(clone.stderr || clone.stdout || "git clone failed");
      await updateCodingSession(params.databases, session.id, {
        status: "failed",
        sandboxId: box.id,
        events: appendSessionEvent(session.events, "error", `Clone into /workspace failed: ${detail}`),
      });
      return { error: `Clone into /workspace failed: ${detail}`, retryable: true };
    }
    branch = await driver.exec(box.id, createSandboxBranchShell(headBranch), "/workspace");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sandbox clone failed";
    await updateCodingSession(params.databases, session.id, {
      status: "failed",
      sandboxId: box.id,
      events: appendSessionEvent(session.events, "error", message),
    });
    return { error: message, retryable: !isAzureSandboxAccessError(message) };
  }
  const sourceMode = parseSandboxSourceMode(clone.stdout);
  const events = appendSessionEvent(
    appendSessionEvent(session.events, "clone", redactSecrets(clone.stdout || clone.stderr).slice(0, 1200), {
      sourceMode,
      gitAvailable: sourceMode === "git",
    }),
    "branch",
    branch.stdout.slice(0, 400),
    { driver: driver.kind, sandboxId: box.id },
  );

  const finished = await finishPreview({
    databases: params.databases,
    sessionId: session.id,
    events,
    sandboxId: box.id,
    exposePort,
    environment: environment ?? undefined,
    secrets,
    codingAgent,
    autoMode,
  });

  const next = await updateCodingSession(params.databases, session.id, {
    status: "running",
    sandboxId: box.id,
    previewUrl: finished.previewUrl,
    headBranch,
    runId: params.runId,
    repoId: resolved.repoId,
    workerModelId: DEEPSEEK_PRO_MODEL_ID,
    orchestratorModelId: FOUNDRY_GPT_LUNA_MODEL_ID,
    events: finished.events,
    meta: finished.meta,
    previewLive: finished.previewLive,
    driver: finished.driver as CodingSessionMeta["driver"],
    codingAgent: finished.meta.codingAgent,
    artifacts: finished.meta.artifacts,
  });

  const preview = describeCodingPreview({
    previewUrl: finished.previewUrl,
    driver: finished.driver,
    status: next?.status ?? "running",
    sandboxId: box.id,
    previewLive: finished.previewLive,
  });

  return {
    sessionId: session.id,
    status: next?.status ?? "running",
    sandboxId: box.id,
    previewUrl: preview.live ? finished.previewUrl : finished.previewUrl,
    previewLive: preview.live,
    previewStub: preview.stub,
    headBranch,
    driver: driver.kind,
    owner: resolved.owner,
    repo: resolved.repo,
    codingAgent: codingAgent.id,
    codingAgentReason: codingAgent.reason,
    startCommand: finished.meta.startCommand,
    packageManager: finished.meta.packageManager,
    investigateOnly: Boolean(params.investigateOnly),
    autoMode,
    note:
      driver.kind === "stub"
        ? preview.note
        : preview.live
          ? "Sandbox cloned the repo, installed dependencies, started the app, and exposed a live preview port."
          : preview.note,
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
