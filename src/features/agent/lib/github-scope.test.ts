import { describe, expect, it } from "vitest";

import { formatProjectGithubLine, hasGithubRepoAccess, hasProjectGithubRepo } from "./github-scope";
import type { AgentContext } from "../types";

function context(repos: AgentContext["githubRepos"] = []): AgentContext {
  return {
    user: { id: "u1", name: "Ada", email: "ada@fairlx.dev" },
    workspaces: [{ id: "w1", name: "Acme" }],
    projects: [{ id: "p1", name: "Website", workspaceId: "w1" }],
    workItems: [],
    notifications: [],
    githubRepos: repos,
    integrations: [],
    docs: [],
  };
}

describe("github scope", () => {
  it("treats another project's repo as missing for this project", () => {
    const ctx = context([{ id: "r1", owner: "acme", repositoryName: "other", projectId: "p2" }]);
    expect(hasProjectGithubRepo(ctx, "p1")).toBe(false);
    expect(formatProjectGithubLine(ctx, "p1")).toMatch(/none attached/i);
  });

  it("detects a repo on the current project", () => {
    const ctx = context([{ id: "r1", owner: "acme", repositoryName: "app", projectId: "p1" }]);
    expect(hasProjectGithubRepo(ctx, "p1")).toBe(true);
    expect(formatProjectGithubLine(ctx, "p1")).toContain("acme/app");
    expect(formatProjectGithubLine(ctx, "p1")).toMatch(/request_capability/i);
  });

  it("ignores pending oauth stubs", () => {
    const ctx = context([{ id: "r1", owner: "", repositoryName: "", githubUrl: "pending", projectId: "p1" }]);
    expect(hasProjectGithubRepo(ctx, "p1")).toBe(false);
  });

  it("ignores pending owner/name placeholders", () => {
    const ctx = context([{ id: "r1", owner: "pending", repositoryName: "pending", githubUrl: "pending", projectId: "p1" }]);
    expect(hasProjectGithubRepo(ctx, "p1")).toBe(false);
    expect(formatProjectGithubLine(ctx, "p1")).toMatch(/none attached/i);
  });

  it("tells the agent to create a repo when the GitHub account is connected", () => {
    const ctx = context();
    ctx.githubAccount = { connected: true, login: "surendra" };
    ctx.githubAttachProjectIds = ["p1"];
    expect(formatProjectGithubLine(ctx, "p1")).toMatch(/account connected/i);
    expect(formatProjectGithubLine(ctx, "p1")).toMatch(/github_list_repos/);
    expect(formatProjectGithubLine(ctx, "p1")).toMatch(/github_link_repo/);
    expect(formatProjectGithubLine(ctx, "p1")).toMatch(/github_create_repo/);
    expect(formatProjectGithubLine(ctx, "p1")).toMatch(/linkToProject true/);
    expect(formatProjectGithubLine(ctx, "p1")).toMatch(/github_write_file README.md/);
  });

  it("does not let a worker attach a repository", () => {
    const ctx = context();
    ctx.githubAccount = { connected: true, login: "worker" };
    expect(formatProjectGithubLine(ctx, "p1")).toMatch(/cannot attach/i);
    expect(formatProjectGithubLine(ctx, "p1")).toMatch(/github_list_repos/);
    expect(formatProjectGithubLine(ctx, "p1")).toMatch(/linkToProject false/);
  });

  it("uses the acting GitHub user once a repo is attached", () => {
    const ctx = context([{ id: "r1", owner: "acme", repositoryName: "app", projectId: "p1" }]);
    ctx.githubAccount = { connected: true, login: "surendra" };
    expect(formatProjectGithubLine(ctx, "p1")).toMatch(/@surendra/);
    expect(formatProjectGithubLine(ctx, "p1")).toMatch(/Never call request_capability/i);
  });

  it("requires Fairlx GitHub API access, not only Sign in with GitHub", () => {
    const ctx = context();
    ctx.githubAccount = { connected: true, login: "surendra", hasRepoAccess: false };
    expect(hasGithubRepoAccess(ctx)).toBe(false);
    ctx.githubAccount = { connected: true, login: "surendra", hasRepoAccess: true };
    expect(hasGithubRepoAccess(ctx)).toBe(true);
  });
});
