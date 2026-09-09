import type { AgentRun, AgentRunMode } from "../types";
import { hasFullAttachedImages } from "./attach-images";
import { displayUserContent } from "./session-context";

export function newAgentRunId(): string {
  return crypto.randomUUID();
}

export function buildOptimisticAgentRun(input: {
  id: string;
  prompt: string;
  workspaceId?: string;
  projectId?: string;
  mode?: AgentRunMode;
}): AgentRun {
  const createdAt = new Date().toISOString();
  const visible =
    displayUserContent(input.prompt) || (hasFullAttachedImages(input.prompt) ? "Image" : input.prompt);
  const title = visible.replace(/\s+/g, " ").slice(0, 80);
  return {
    id: input.id,
    userId: "",
    title,
    prompt: visible,
    status: "running",
    mode: input.mode === "manual" ? "manual" : "agent",
    workspaceId: input.workspaceId || undefined,
    projectId: input.projectId || undefined,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "user",
        content: input.prompt,
        createdAt,
      },
    ],
    events: [],
    kind: "chat",
    createdAt,
    updatedAt: createdAt,
  };
}

export function shouldRecoverInterruptedTurn(
  run: { status?: string; createdAt?: string },
  now = Date.now(),
): boolean {
  if (run.status !== "running") return false;
  const created = Date.parse(run.createdAt || "");
  if (!Number.isFinite(created)) return true;
  // Fresh creates already schedule a turn. Recover only after a refresh mid-run.
  return now - created > 8_000;
}

export function navigateToAgentRun(
  router: { prefetch: (href: string) => void; push: (href: string) => void },
  runId: string,
) {
  const href = `/agent/workflow?runId=${encodeURIComponent(runId)}`;
  router.prefetch(href);
  router.push(href);
}
