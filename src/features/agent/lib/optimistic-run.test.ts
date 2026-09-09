import { describe, expect, it } from "vitest";

import { buildOptimisticAgentRun, newAgentRunId, shouldRecoverInterruptedTurn } from "./optimistic-run";
import { isAgentRunId } from "./run-id";

describe("optimistic agent run", () => {
  it("builds a running chat the workflow can render immediately", () => {
    const run = buildOptimisticAgentRun({
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      prompt: "Plan the sprint",
      workspaceId: "ws-1",
      projectId: "proj-1",
    });
    expect(run.status).toBe("running");
    expect(run.kind).toBe("chat");
    expect(run.title).toBe("Plan the sprint");
    expect(run.messages[0]?.role).toBe("user");
    expect(run.messages[0]?.content).toBe("Plan the sprint");
  });

  it("uses Appwrite-safe ids", () => {
    const id = newAgentRunId();
    expect(isAgentRunId(id)).toBe(true);
  });

  it("does not recover a turn that was just created", () => {
    const createdAt = new Date().toISOString();
    expect(shouldRecoverInterruptedTurn({ status: "running", createdAt })).toBe(false);
    expect(
      shouldRecoverInterruptedTurn(
        { status: "running", createdAt: new Date(Date.now() - 20_000).toISOString() },
      ),
    ).toBe(true);
    expect(shouldRecoverInterruptedTurn({ status: "completed", createdAt })).toBe(false);
  });
});
