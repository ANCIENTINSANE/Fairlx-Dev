import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canManageProjectGithubIntegration } from "../lib/github-permissions";

describe("canManageProjectGithubIntegration", () => {
  it("allows workspace owners and admins", () => {
    expect(canManageProjectGithubIntegration({ workspaceRole: "OWNER" })).toBe(true);
    expect(canManageProjectGithubIntegration({ workspaceRole: "ADMIN" })).toBe(true);
  });

  it("allows project admins, owners, and settings editors", () => {
    expect(canManageProjectGithubIntegration({ isProjectAdmin: true })).toBe(true);
    expect(canManageProjectGithubIntegration({ isProjectOwner: true })).toBe(true);
    expect(canManageProjectGithubIntegration({ permissions: ["project.settings.edit"] })).toBe(true);
    expect(canManageProjectGithubIntegration({ permissions: ["project.settings.manage"] })).toBe(true);
  });

  it("denies ordinary project workers", () => {
    expect(
      canManageProjectGithubIntegration({
        workspaceRole: "MEMBER",
        permissions: ["project.view", "project.tasks.edit"],
      }),
    ).toBe(false);
  });
});
