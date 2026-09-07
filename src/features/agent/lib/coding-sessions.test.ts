import { describe, expect, it } from "vitest";

import { guidedWalkthrough, isFairlxAgentAssignee, mentionsFairlxAgent } from "./coding-sessions";
import { redactSecrets } from "./sandbox/types";
import { StubSandboxDriver, resetStubSandboxes } from "./sandbox/stub";

describe("coding session helpers", () => {
  it("detects Fairlx Agent assignees and @Fairlx mentions", () => {
    expect(isFairlxAgentAssignee(["fairlx-agent"])).toBe(true);
    expect(isFairlxAgentAssignee(["someone-else"])).toBe(false);
    expect(mentionsFairlxAgent("Please @Fairlx take a look")).toBe(true);
    expect(mentionsFairlxAgent("hello team")).toBe(false);
  });

  it("builds a per-file walkthrough from the compare payload", () => {
    const text = guidedWalkthrough([
      { filename: "src/ui.tsx", status: "modified", additions: 4, deletions: 1, patch: "@@ -10,1 +10,4 @@\n+hi" },
    ]);
    expect(text).toMatch(/src\/ui\.tsx/);
    expect(text).toMatch(/\+4\/-1/);
    expect(text).toMatch(/1 hunk/);
  });

  it("redacts GitHub tokens from clone URLs", () => {
    expect(redactSecrets("git clone https://x-access-token:gho_secret@github.com/acme/app.git")).toContain(
      "x-access-token:***@",
    );
  });
});

describe("stub sandbox driver", () => {
  it("records clone and exec without touching the host", async () => {
    resetStubSandboxes();
    const driver = new StubSandboxDriver();
    const box = await driver.create({ labels: { workItem: "WEB-1" } });
    const clone = await driver.exec(box.id, "git clone https://x-access-token:gho_secret@github.com/acme/app.git");
    expect(clone.exitCode).toBe(0);
    expect(clone.stdout).not.toContain("gho_secret");
    await driver.writeFile(box.id, "/workspace/README.md", "# hi");
    expect(await driver.readFile(box.id, "/workspace/README.md")).toBe("# hi");
    const preview = await driver.exposePort(box.id, 3000);
    expect(preview).toContain("preview.stub.fairlx.local");
    await driver.destroy(box.id);
  });
});
