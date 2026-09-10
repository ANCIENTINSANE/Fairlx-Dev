import type { CodingSession, CodingSessionEvent } from "../types";
import { describeCodingPreview } from "./sandbox-preview";

/**
 * Turn the raw coding-session event log into a build pipeline the user can read:
 *
 *   create sandbox → clone repo → install deps → build & start → link live
 *
 * Each phase gets a status and a rough ETA from typical durations so the Preview tab can show
 * "Link is preparing · ~40s left" before the URL is actually healthy.
 */

export type SandboxPhaseId = "create" | "clone" | "install" | "start" | "live";
export type SandboxPhaseStatus = "pending" | "active" | "done" | "failed" | "skipped";

export type SandboxPhase = {
  id: SandboxPhaseId;
  label: string;
  hint: string;
  status: SandboxPhaseStatus;
  startedAt?: string;
  endedAt?: string;
  /** Typical wall-clock for this phase, used for the ETA. */
  typicalMs: number;
  detail?: string;
};

export type SandboxPhasesView = {
  phases: SandboxPhase[];
  current: SandboxPhaseId | null;
  /** 0–100 across the whole pipeline. */
  percent: number;
  /** Seconds remaining (estimate). 0 when live / failed / stuck. */
  etaSeconds: number;
  /** Public URL as soon as it is reserved, even before the app answers. */
  reservedUrl?: string;
  live: boolean;
  failed: boolean;
  paused: boolean;
  destroyed: boolean;
  /** Prepare finished (or timed out) without a healthy preview — reboot instead of spinning. */
  stuck: boolean;
  headline: string;
};

/** A phase that has been "active" this long is no longer preparing — it is hung. */
export const SANDBOX_PHASE_STUCK_MULTIPLIER = 4;
/** Whole pipeline without a live preview. */
export const SANDBOX_PIPELINE_STUCK_MS = 8 * 60_000;
/** Dev server recorded but health never passed. */
export const SANDBOX_HEALTH_STUCK_MS = 90_000;

const PHASES: Array<Omit<SandboxPhase, "status">> = [
  { id: "create", label: "Create sandbox", hint: "Spinning up an isolated Azure VM", typicalMs: 20_000 },
  { id: "clone", label: "Clone repo", hint: "Fetching your GitHub branch into /workspace", typicalMs: 15_000 },
  { id: "install", label: "Install", hint: "Detecting the toolchain and installing dependencies", typicalMs: 60_000 },
  { id: "start", label: "Build & start", hint: "Starting the dev server on the exposed port", typicalMs: 30_000 },
  { id: "live", label: "Link live", hint: "Health check passed — preview is shareable", typicalMs: 5_000 },
];

const PHASE_ORDER: SandboxPhaseId[] = PHASES.map((phase) => phase.id);

function ms(value?: string): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstEvent(events: CodingSessionEvent[], types: string[], detailRe?: RegExp): CodingSessionEvent | undefined {
  return events.find((event) => types.includes(event.type) && (!detailRe || detailRe.test(event.detail || "")));
}

function lastEvent(events: CodingSessionEvent[], types: string[]): CodingSessionEvent | undefined {
  return [...events].reverse().find((event) => types.includes(event.type));
}

export function describeSandboxPhases(session: CodingSession | null | undefined, now = Date.now()): SandboxPhasesView {
  const events = session?.events ?? [];
  const preview = describeCodingPreview({
    previewUrl: session?.previewUrl,
    status: session?.status,
    sandboxId: session?.sandboxId,
    driver: session?.driver,
    previewLive: session?.previewLive,
  });
  const failed = session?.status === "failed";
  const paused = session?.meta?.lifecycle === "paused";
  const destroyed = session?.meta?.lifecycle === "destroyed" || (session?.status === "stopped" && !session.sandboxId);
  const errorEvent = lastEvent(events, ["error"]);
  const emptyWorkspace = events.some((event) => /Empty \/workspace/i.test(event.detail || ""));
  const healthFail = events.some(
    (event) =>
      event.type === "dev_server" &&
      (event.detail || "").toLowerCase().includes("recorded") &&
      (event.payload as { previewLive?: boolean } | undefined)?.previewLive !== true,
  );

  const createStart = firstEvent(events, ["queued", "preparing"]);
  const createEnd = firstEvent(events, ["preparing"], /created|cloning into|retrying clone/i) ?? (session?.sandboxId ? firstEvent(events, ["clone", "branch"]) : undefined);
  const cloneEnd = firstEvent(events, ["clone"]);
  const installStart = firstEvent(events, ["install"]);
  const installEvents = events.filter((event) => event.type === "install");
  const installEnd = installEvents.length >= 2 ? installEvents[installEvents.length - 1] : undefined;
  const startEnd = firstEvent(events, ["dev_server"]);
  const liveAt = preview.live ? (startEnd?.createdAt ?? session?.updatedAt) : undefined;

  const boundaries: Record<SandboxPhaseId, { start?: string; end?: string }> = {
    create: { start: createStart?.createdAt ?? session?.createdAt, end: createEnd?.createdAt ?? cloneEnd?.createdAt },
    clone: { start: createEnd?.createdAt, end: cloneEnd?.createdAt ?? installStart?.createdAt },
    install: { start: installStart?.createdAt, end: installEnd?.createdAt ?? startEnd?.createdAt },
    start: { start: installEnd?.createdAt ?? startEnd?.createdAt, end: startEnd?.createdAt },
    live: { start: startEnd?.createdAt, end: liveAt },
  };

  // Highest phase we have evidence for.
  let reached = -1;
  if (session) reached = 0;
  if (session?.sandboxId || createEnd) reached = Math.max(reached, 1);
  if (cloneEnd) reached = Math.max(reached, 2);
  if (installEnd || startEnd) reached = Math.max(reached, 3);
  if (startEnd) reached = Math.max(reached, 4);
  const liveDone = preview.live;

  const pipelineStart = ms(createStart?.createdAt ?? session?.createdAt);
  const healthStarted = ms(startEnd?.createdAt);
  const activeStartMs = (id: SandboxPhaseId) => ms(boundaries[id].start);
  let stuck = false;
  if (session && !liveDone && !failed && !destroyed && !paused) {
    const age = pipelineStart ? now - pipelineStart : 0;
    if (startEnd && healthStarted && now - healthStarted >= SANDBOX_HEALTH_STUCK_MS) stuck = true;
    else if (!emptyWorkspace && age >= SANDBOX_PIPELINE_STUCK_MS) stuck = true;
    else if (emptyWorkspace && age >= SANDBOX_PIPELINE_STUCK_MS * 2) stuck = true;
    else {
      const currentId: SandboxPhaseId =
        reached <= 0 ? "create" : reached === 1 ? "clone" : reached === 2 ? "install" : reached === 3 ? "start" : "live";
      const typical = PHASES.find((phase) => phase.id === currentId)?.typicalMs ?? 30_000;
      const started = activeStartMs(currentId);
      if (started && now - started >= typical * SANDBOX_PHASE_STUCK_MULTIPLIER) stuck = true;
    }
  }

  const phases: SandboxPhase[] = PHASES.map((base, index) => {
    const bounds = boundaries[base.id];
    let status: SandboxPhaseStatus = "pending";
    if (liveDone) status = "done";
    else if (index < reached) status = "done";
    else if (index === reached) status = failed || stuck ? "failed" : destroyed || paused ? "skipped" : "active";
    if ((failed || stuck) && index > reached) status = "skipped";
    if (destroyed) status = index <= reached ? "done" : "skipped";
    if (paused && !liveDone) status = index <= reached ? "done" : "skipped";
    return {
      ...base,
      status,
      startedAt: bounds.start,
      endedAt: status === "done" ? bounds.end ?? bounds.start : undefined,
      detail:
        base.id === "install" && installEnd?.payload && typeof installEnd.payload === "object"
          ? String((installEnd.payload as { packageManager?: string }).packageManager || "")
          : base.id === "start" && startEnd?.payload && typeof startEnd.payload === "object"
            ? String((startEnd.payload as { startCommand?: string }).startCommand || "").slice(0, 80)
            : status === "failed"
              ? (errorEvent?.detail || (healthFail ? "Health check never passed" : "")).slice(0, 160)
              : undefined,
    };
  });

  const current = liveDone
    ? null
    : phases.find((phase) => phase.status === "active")?.id ??
      phases.find((phase) => phase.status === "failed")?.id ??
      null;
  const currentIndex = current ? PHASE_ORDER.indexOf(current) : liveDone ? PHASES.length : reached;

  // ETA: remaining typical time of pending phases + what's left of the active one.
  // Do not floor leftover time — that left the UI saying "~5s" for hours.
  let etaMs = 0;
  if (!liveDone && !failed && !destroyed && !paused && !stuck && session) {
    for (let i = Math.max(0, currentIndex); i < PHASES.length; i += 1) {
      const phase = phases[i]!;
      if (phase.status === "active") {
        const elapsed = phase.startedAt ? Math.max(0, now - ms(phase.startedAt)) : 0;
        etaMs += Math.max(0, phase.typicalMs - elapsed);
      } else if (phase.status === "pending") {
        etaMs += phase.typicalMs;
      }
    }
  }

  const totalTypical = PHASES.reduce((sum, phase) => sum + phase.typicalMs, 0);
  const doneTypical = phases.filter((phase) => phase.status === "done").reduce((sum, phase) => sum + phase.typicalMs, 0);
  const activePhase = phases.find((phase) => phase.status === "active");
  const activeProgress = activePhase?.startedAt
    ? Math.min(0.9, Math.max(0, now - ms(activePhase.startedAt)) / activePhase.typicalMs) * activePhase.typicalMs
    : 0;
  const percent = liveDone ? 100 : Math.round(((doneTypical + activeProgress) / totalTypical) * 100);

  let headline = "No sandbox yet";
  if (destroyed) headline = "Sandbox destroyed after 30 min idle";
  else if (paused) headline = "Sandbox paused after 15 min idle";
  else if (failed) headline = "Sandbox could not start";
  else if (stuck && current === "live") headline = "Preview never became healthy";
  else if (stuck && current === "create") headline = "Sandbox create is stuck";
  else if (stuck && current === "clone") headline = "Clone is stuck";
  else if (stuck && current === "install") headline = "Install is stuck";
  else if (stuck && current === "start") headline = "Build is stuck";
  else if (stuck) headline = "Sandbox is stuck";
  else if (liveDone) headline = "Preview is live";
  else if (emptyWorkspace) headline = "Waiting for the agent to scaffold the app";
  else if (session && current === "create") headline = "Creating a sandbox";
  else if (session && current === "clone") headline = "Just created a sandbox · cloning your repo";
  else if (session && current === "install") headline = "Installing dependencies";
  else if (session && current === "start") headline = "Build is preparing";
  else if (session && current === "live") headline = "Link is preparing";
  else if (session) headline = "Sandbox is preparing";

  return {
    phases,
    current,
    percent: Math.max(0, Math.min(100, percent)),
    etaSeconds: Math.round(etaMs / 1000),
    reservedUrl: preview.url || undefined,
    live: liveDone,
    failed,
    paused,
    destroyed,
    stuck,
    headline,
  };
}

export function formatEta(seconds: number): string {
  if (seconds <= 0) return "";
  if (seconds < 60) return `~${Math.max(5, Math.round(seconds / 5) * 5)}s`;
  const minutes = Math.round(seconds / 60);
  return `~${minutes} min`;
}
