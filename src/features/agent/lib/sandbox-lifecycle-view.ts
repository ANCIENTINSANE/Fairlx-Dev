import type { CodingSession, SandboxLifecycleState } from "../types";

/**
 * Pure (client-safe) half of the sandbox idle lifecycle. Server mutations live in
 * `sandbox-lifecycle.ts`, which re-exports everything here.
 */

export const SANDBOX_IDLE_PAUSE_MS = 15 * 60 * 1000;
export const SANDBOX_IDLE_DESTROY_MS = 30 * 60 * 1000;
/** Don't write a touch more often than this; the poller hits every 2.5s. */
export const SANDBOX_TOUCH_THROTTLE_MS = 45 * 1000;

export const LIFECYCLE_EVENT = "lifecycle";
const ACTIVE_STATUSES = new Set(["running", "awaiting_review", "iterating", "merging"]);

export type SandboxLifecycleView = {
  state: SandboxLifecycleState | "none";
  lastActivityAt?: string;
  idleMs: number;
  /** ms until the next transition (pause or destroy); 0 when already destroyed. */
  nextTransitionInMs: number;
  nextTransition: "pause" | "destroy" | null;
};

export function toMs(value?: string): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Best-known last activity: explicit touch, else the newest non-lifecycle event, else updatedAt. */
export function sessionLastActivityAt(session: Pick<CodingSession, "events" | "meta" | "updatedAt" | "createdAt">): string {
  const touched = toMs(session.meta?.lastActivityAt);
  const lastEvent = [...(session.events ?? [])]
    .reverse()
    .find((event) => event.type !== LIFECYCLE_EVENT && event.type !== "session_meta");
  const eventMs = toMs(lastEvent?.createdAt);
  const best = Math.max(touched, eventMs, touched || eventMs ? 0 : toMs(session.updatedAt || session.createdAt));
  return new Date(best || Date.now()).toISOString();
}

export function sessionHasLiveSandbox(session: Pick<CodingSession, "sandboxId" | "status" | "meta">): boolean {
  if (!session.sandboxId) return false;
  if (!ACTIVE_STATUSES.has(session.status)) return false;
  return session.meta?.lifecycle !== "destroyed";
}

export function describeSandboxLifecycle(
  session: Pick<CodingSession, "sandboxId" | "status" | "events" | "meta" | "updatedAt" | "createdAt"> | null | undefined,
  now = Date.now(),
): SandboxLifecycleView {
  if (!session?.sandboxId) {
    return { state: "none", idleMs: 0, nextTransitionInMs: 0, nextTransition: null };
  }
  const lifecycle = session.meta?.lifecycle ?? "active";
  const lastActivityAt = sessionLastActivityAt(session);
  const idleMs = Math.max(0, now - toMs(lastActivityAt));
  if (lifecycle === "destroyed") {
    return { state: "destroyed", lastActivityAt, idleMs, nextTransitionInMs: 0, nextTransition: null };
  }
  if (lifecycle === "paused") {
    return {
      state: "paused",
      lastActivityAt,
      idleMs,
      nextTransitionInMs: Math.max(0, SANDBOX_IDLE_DESTROY_MS - idleMs),
      nextTransition: "destroy",
    };
  }
  return {
    state: "active",
    lastActivityAt,
    idleMs,
    nextTransitionInMs: Math.max(0, SANDBOX_IDLE_PAUSE_MS - idleMs),
    nextTransition: "pause",
  };
}

export function formatIdleCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 1) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
