import { describe, expect, it } from "vitest";

import { isPersistedTruncatedAssistant, isToolNarrationOnly, sanitizeAssistantVisible } from "./visible-content";

describe("sanitizeAssistantVisible", () => {
  it("hides XML tool calls, IDs, and lookup narration", () => {
    const visible = sanitizeAssistantVisible(
      [
        "Let me check your assigned tasks properly.",
        'fairlx:listWorkItems { "workspaceId": "69d2d1720023d3c1f3e9" } </fairlx:listWorkItems>',
      ].join("\n"),
    );
    expect(visible).toBe("");
    expect(isToolNarrationOnly(
      'I\'ll look up the workspace members and their roles.\nfairlx:listWorkspaceMembers { "workspaceId": "69d2d1720023d3c1f3e9" } </fairlx:listWorkspaceMembers>',
    )).toBe(true);
    expect(sanitizeAssistantVisible("Let me get the project details first")).toBe("");
  });

  it("keeps the real answer and strips leftover IDs", () => {
    const visible = sanitizeAssistantVisible(
      "Ada is an Admin and Sam is a Member. Workspace 69d2d1720023d3c1f3e9.",
    );
    expect(visible).toContain("Ada is an Admin");
    expect(visible).not.toMatch(/69d2d1720023d3c1f3e9/);
  });

  it("keeps Azure preview URLs whose hostname is a sandbox UUID", () => {
    const url = "https://421b50f0-ed05-46b1-9ade-caafc10a7ea8--3000.centralindia.adcproxy.io/";
    const visible = sanitizeAssistantVisible(`The sandbox is live! [Open Preview](${url})`);
    expect(visible).toContain(url);
    expect(visible).not.toContain("https://--3000.");
  });

  it("still strips bare UUIDs outside URLs", () => {
    const visible = sanitizeAssistantVisible("Session 421b50f0-ed05-46b1-9ade-caafc10a7ea8 is ready.");
    expect(visible).toContain("Session");
    expect(visible).not.toMatch(/421b50f0/);
  });

  it("unwraps persisted truncated JSON so the preview is readable", () => {
    const wrapped = JSON.stringify({
      truncated: true,
      preview: "3. As a customer , I wan…",
    });
    const visible = sanitizeAssistantVisible(wrapped);
    expect(visible).toBe("3. As a customer , I wan…");
    expect(isPersistedTruncatedAssistant(wrapped)).toBe(true);
    expect(isPersistedTruncatedAssistant("Good — full proposal.")).toBe(false);
  });
});
