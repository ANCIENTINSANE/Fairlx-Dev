import { describe, expect, it, vi } from "vitest";

import type { CodingSession, CodingSessionEvent } from "../types";
import {
  SANDBOX_IDLE_DESTROY_MS,
  SANDBOX_IDLE_PAUSE_MS,
  describeSandboxLifecycle,
  reapIdleSandboxes,
  sessionLastActivityAt,
  shouldTouchOnPreviewPoll,
} from "./sandbox-lifecycle";
import { describeSandboxPhases } from "./sandbox-phases";

vi.mock("./coding-sessions", async () => {
  const actual = await vi.importActual<typeof import("./coding-sessions")>("./coding-sessions");
  return {
    ...actual,
    listActiveCodingSessions: vi.fn(),
    updateCodingSession: vi.fn(async (_db: unknown, _id: string, patch: Record<string, unknown>) => patch),
  };
});

import { listActiveCodingSessions, updateCodingSession } from "./coding-sessions";

const T0 = Date.parse("2026-09-10T10:00:00Z");
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

function event(type: string, offsetMs: number, detail?: string, payload?: unknown): CodingSessionEvent {
  return { id: `${type}-${offsetMs}`, type, detail, payload, createdAt: iso(offsetMs) };
}

function session(overrides: Partial<CodingSession> = {}): CodingSession {
  return {
    id: "s1",
    userId: "u1",
    workItemId: "w1",
    projectId: "p1",
    workspaceId: "ws1",
    status: "running",
    sandboxId: "sb-1",
    events: [event("exec", -40 * 60_000, "npm test")],
    createdAt: iso(-60 * 60_000),
    updatedAt: iso(0),
    ...overrides,
  };
}

describe("sandbox lifecycle", () => {
  it("uses the newest activity signal", () => {
    const s = session({ meta: { lastActivityAt: iso(30_000) } });
    expect(sessionLastActivityAt(s)).toBe(iso(30_000));
    const view = describeSandboxLifecycle(s, T0 + 5 * 60_000);
    expect(view.state).toBe("active");
    expect(view.nextTransition).toBe("pause");
    expect(view.nextTransitionInMs).toBe(SANDBOX_IDLE_PAUSE_MS - (5 * 60_000 - 30_000));
  });

  it("pauses at 15 minutes and destroys at 30", async () => {
    const driver = { kind: "azure" as const, suspend: vi.fn(async () => {}), destroy: vi.fn(async () => {}) } as never;
    const fresh = session({ id: "fresh", meta: { lastActivityAt: iso(0) } });
    const idle16 = session({ id: "idle16", meta: { lastActivityAt: iso(-16 * 60_000) } });
    const idle31 = session({ id: "idle31", meta: { lastActivityAt: iso(-31 * 60_000) } });
    const paused31 = session({ id: "paused31", meta: { lastActivityAt: iso(-31 * 60_000), lifecycle: "paused" } });
    vi.mocked(listActiveCodingSessions).mockResolvedValue([fresh, idle16, idle31, paused31]);

    const result = await reapIdleSandboxes({} as never, driver, { now: T0 });
    expect(result.checked).toBe(4);
    expect(result.paused).toEqual(["idle16"]);
    expect(result.destroyed.sort()).toEqual(["idle31", "paused31"]);
    expect(vi.mocked(updateCodingSession)).toHaveBeenCalled();
    expect(SANDBOX_IDLE_DESTROY_MS).toBe(30 * 60_000);
  });

  it("reports destroyed sandboxes as needing a restart", () => {
    const view = describeSandboxLifecycle(session({ meta: { lifecycle: "destroyed" } }), T0);
    expect(view.state).toBe("destroyed");
    expect(view.nextTransition).toBeNull();
  });
});

describe("sandbox phases", () => {
  it("walks create → clone → install → start → live with an ETA", () => {
    const preparing = session({
      status: "preparing",
      sandboxId: undefined,
      previewUrl: "https://abc--3000.eastus.adcproxy.io/",
      events: [event("queued", -50_000, "Coding session queued"), event("preparing", -45_000, "Creating Azure sandbox")],
    });
    const view = describeSandboxPhases(preparing, T0);
    expect(view.current).toBe("create");
    expect(view.headline).toBe("Creating a sandbox");
    expect(view.reservedUrl).toMatch(/adcproxy/);
    expect(view.etaSeconds).toBeGreaterThan(60);
    expect(view.percent).toBeLessThan(30);

    const installing = session({
      status: "preparing",
      events: [
        event("queued", -120_000),
        event("preparing", -110_000, "Created Azure sandbox, cloning into /workspace"),
        event("clone", -90_000, "ok"),
        event("install", -80_000, "Detecting toolchain and installing dependencies"),
      ],
    });
    const mid = describeSandboxPhases(installing, T0);
    expect(mid.current).toBe("install");
    expect(mid.phases.find((p) => p.id === "clone")?.status).toBe("done");
    expect(mid.headline).toBe("Installing dependencies");

    const live = session({
      status: "running",
      previewLive: true,
      previewUrl: "https://abc--3000.eastus.adcproxy.io/",
      events: [
        event("queued", -200_000),
        event("preparing", -190_000, "Created Azure sandbox, cloning into /workspace"),
        event("clone", -170_000),
        event("install", -160_000),
        event("install", -100_000, "done", { packageManager: "pnpm" }),
        event("dev_server", -60_000, "Dev server healthy", { startCommand: "pnpm dev" }),
      ],
    });
    const done = describeSandboxPhases(live, T0);
    expect(done.live).toBe(true);
    expect(done.percent).toBe(100);
    expect(done.etaSeconds).toBe(0);
    expect(done.phases.every((p) => p.status === "done")).toBe(true);
  });

  it("marks a hung health check as stuck so the UI can offer reboot", () => {
    const hung = session({
      status: "running",
      previewLive: false,
      previewUrl: "https://abc--3000.eastus.adcproxy.io/",
      events: [
        event("queued", -3 * 60 * 60_000),
        event("preparing", -3 * 60 * 60_000 + 10_000, "Created Azure sandbox, cloning into /workspace"),
        event("clone", -3 * 60 * 60_000 + 40_000),
        event("install", -3 * 60 * 60_000 + 50_000),
        event("install", -3 * 60 * 60_000 + 90_000, "done", { packageManager: "npm" }),
        event("dev_server", -3 * 60 * 60_000 + 100_000, "Dev server start recorded", { previewLive: false, startCommand: "npm run dev" }),
      ],
    });
    const view = describeSandboxPhases(hung, T0);
    expect(view.stuck).toBe(true);
    expect(view.live).toBe(false);
    expect(view.etaSeconds).toBe(0);
    expect(view.headline).toMatch(/never became healthy|stuck/i);
    expect(view.phases.find((p) => p.id === "live")?.status).toBe("failed");
    expect(shouldTouchOnPreviewPoll(hung, T0)).toBe(false);
  });

  it("does not treat a fresh empty workspace as stuck", () => {
    const empty = session({
      status: "running",
      previewLive: false,
      events: [
        event("queued", -20_000),
        event("install", -5_000, "Empty /workspace (no package.json). Skipping install/start until the agent scaffolds the app."),
      ],
    });
    const view = describeSandboxPhases(empty, T0);
    expect(view.stuck).toBe(false);
    expect(view.headline).toMatch(/scaffold/i);
  });

  it("marks failures and paused sandboxes", () => {
    const failed = session({
      status: "failed",
      sandboxId: undefined,
      events: [event("queued", -10_000), event("error", -5_000, "AADSTS700016 bad tenant")],
    });
    const view = describeSandboxPhases(failed, T0);
    expect(view.failed).toBe(true);
    expect(view.phases[0]?.status).toBe("failed");
    expect(view.phases[0]?.detail).toMatch(/AADSTS/);
    const paused = describeSandboxPhases(session({ meta: { lifecycle: "paused" } }), T0);
    expect(paused.paused).toBe(true);
    expect(paused.headline).toMatch(/paused/);
  });
});
