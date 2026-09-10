import type { Databases } from "node-appwrite";

import type { CodingSession, CodingSessionMeta } from "../types";
import { appendSessionEvent, listActiveCodingSessions, updateCodingSession } from "./coding-sessions";
import type { SandboxDriver } from "./sandbox";
import { recheckSandboxHealth } from "./sandbox-prepare";
import { describeSandboxPhases } from "./sandbox-phases";

/**
 * Sandbox idle lifecycle.
 *
 *  - One live sandbox per (user, project). Ten teammates on a project get ten sandboxes; one
 *    person never gets two for the same project.
 *  - 15 minutes without activity → pause (Azure `stop`, keeps disk, stops billing CPU).
 *  - 30 minutes without activity → destroy. The user can restart / regenerate the link later.
 *
 * "Activity" is anything that proves someone is using it: agent exec, a chat turn on the bound
 * run, the Preview tab being open, or an explicit touch from the UI.
 */

export {
  SANDBOX_IDLE_DESTROY_MS,
  SANDBOX_IDLE_PAUSE_MS,
  SANDBOX_TOUCH_THROTTLE_MS,
  describeSandboxLifecycle,
  formatIdleCountdown,
  sessionHasLiveSandbox,
  sessionLastActivityAt,
  type SandboxLifecycleView,
} from "./sandbox-lifecycle-view";
import {
  LIFECYCLE_EVENT,
  SANDBOX_IDLE_DESTROY_MS,
  SANDBOX_IDLE_PAUSE_MS,
  SANDBOX_TOUCH_THROTTLE_MS,
  describeSandboxLifecycle,
  toMs,
} from "./sandbox-lifecycle-view";

/** Mark the sandbox as used. Cheap no-op when it was touched recently. */
export async function touchCodingSession(
  databases: Databases,
  session: CodingSession,
  options?: { force?: boolean; now?: number },
): Promise<CodingSession> {
  if (!session.sandboxId) return session;
  const now = options?.now ?? Date.now();
  const last = toMs(session.meta?.lastActivityAt);
  if (!options?.force && last && now - last < SANDBOX_TOUCH_THROTTLE_MS) return session;
  const meta: CodingSessionMeta = {
    ...(session.meta ?? {}),
    lastActivityAt: new Date(now).toISOString(),
    // A touch on a paused sandbox does not resume it (Azure needs an explicit restart).
    lifecycle: session.meta?.lifecycle === "destroyed" ? "destroyed" : session.meta?.lifecycle ?? "active",
  };
  const updated = await updateCodingSession(databases, session.id, { meta });
  return updated ?? { ...session, meta };
}

export type ReapResult = {
  checked: number;
  paused: string[];
  destroyed: string[];
  errors: Array<{ sessionId: string; error: string }>;
};

/** Pause / destroy idle sandboxes. Safe to call often; each pass is bounded. */
export async function reapIdleSandboxes(
  databases: Databases,
  driver: SandboxDriver,
  options?: { now?: number; limit?: number },
): Promise<ReapResult> {
  const now = options?.now ?? Date.now();
  const result: ReapResult = { checked: 0, paused: [], destroyed: [], errors: [] };
  const sessions = await listActiveCodingSessions(databases, options?.limit ?? 100);
  for (const session of sessions) {
    if (!session.sandboxId) continue;
    result.checked += 1;
    const view = describeSandboxLifecycle(session, now);
    try {
      if (view.state === "active" && view.idleMs >= SANDBOX_IDLE_DESTROY_MS) {
        await destroySessionSandbox(databases, driver, session, "Idle for 30 minutes — sandbox destroyed. Restart it from the Preview tab.");
        result.destroyed.push(session.id);
      } else if (view.state === "paused" && view.idleMs >= SANDBOX_IDLE_DESTROY_MS) {
        await destroySessionSandbox(databases, driver, session, "Paused sandbox idle for 30 minutes — destroyed. Restart it from the Preview tab.");
        result.destroyed.push(session.id);
      } else if (view.state === "active" && view.idleMs >= SANDBOX_IDLE_PAUSE_MS) {
        await driver.suspend(session.sandboxId);
        await updateCodingSession(databases, session.id, {
          previewLive: false,
          meta: { ...(session.meta ?? {}), previewLive: false, lifecycle: "paused", pausedAt: new Date(now).toISOString() },
          events: appendSessionEvent(session.events, LIFECYCLE_EVENT, "Idle for 15 minutes — sandbox paused. Open the preview or send a message to resume."),
        });
        result.paused.push(session.id);
      }
    } catch (error) {
      result.errors.push({ sessionId: session.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export async function destroySessionSandbox(
  databases: Databases,
  driver: SandboxDriver,
  session: CodingSession,
  note: string,
): Promise<void> {
  if (session.sandboxId) {
    try {
      await driver.destroy(session.sandboxId);
    } catch (error) {
      // Already gone is fine; anything else still records the destroy so we stop paying for it.
      if (!/404|not found|gone/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
  await updateCodingSession(databases, session.id, {
    status: "stopped",
    previewLive: false,
    previewUrl: "",
    meta: {
      ...(session.meta ?? {}),
      previewLive: false,
      lifecycle: "destroyed",
      destroyedAt: new Date().toISOString(),
    },
    events: appendSessionEvent(session.events, LIFECYCLE_EVENT, note),
  });
}

let lastOpportunisticReap = 0;
const OPPORTUNISTIC_REAP_INTERVAL_MS = 60 * 1000;

/** Called from hot read paths; runs the reaper at most once a minute per process. */
export function maybeReapIdleSandboxes(databases: Databases, driver: SandboxDriver): void {
  const now = Date.now();
  if (now - lastOpportunisticReap < OPPORTUNISTIC_REAP_INTERVAL_MS) return;
  lastOpportunisticReap = now;
  void reapIdleSandboxes(databases, driver).catch((error) => {
    console.warn("[agent] sandbox reaper failed", error instanceof Error ? error.message : error);
  });
}

const lastHealthRecheck = new Map<string, number>();
const HEALTH_RECHECK_THROTTLE_MS = 45_000;

/**
 * If prepare already finished but previewLive never flipped, probe the port once in a while.
 * Fire-and-forget so GET /coding-sessions stays fast.
 */
export function maybeRecheckPreviewHealth(databases: Databases, driver: SandboxDriver, session: CodingSession): void {
  if (session.previewLive) return;
  if (!session.sandboxId) return;
  if (session.meta?.lifecycle === "paused" || session.meta?.lifecycle === "destroyed") return;
  if (session.status === "failed" || session.status === "stopped" || session.status === "merged") return;
  if (!session.events.some((event) => event.type === "dev_server")) return;
  const now = Date.now();
  const previous = lastHealthRecheck.get(session.id) ?? 0;
  if (now - previous < HEALTH_RECHECK_THROTTLE_MS) return;
  lastHealthRecheck.set(session.id, now);
  void (async () => {
    try {
      const health = await recheckSandboxHealth({
        driver,
        sandboxId: session.sandboxId!,
        port: session.meta?.exposePort || 3000,
      });
      if (!health.live) return;
      await updateCodingSession(databases, session.id, {
        previewLive: true,
        meta: {
          ...(session.meta ?? {}),
          previewLive: true,
          lastActivityAt: new Date().toISOString(),
          lifecycle: "active",
        },
        events: appendSessionEvent(session.events, "preview", "Health check passed on a later probe — preview is live."),
      });
    } catch (error) {
      console.warn("[agent] preview health recheck failed", error instanceof Error ? error.message : error);
    }
  })();
}

/** Preview-tab polling should not keep a hung sandbox from pausing. */
export function shouldTouchOnPreviewPoll(session: CodingSession, now = Date.now()): boolean {
  if (!session.sandboxId) return false;
  if (session.previewLive) return true;
  const phases = describeSandboxPhases(session, now);
  if (phases.stuck || phases.failed || phases.paused || phases.destroyed) return false;
  return session.status === "queued" || session.status === "preparing";
}
