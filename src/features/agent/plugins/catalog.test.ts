import { describe, expect, it } from "vitest";

import { inferCapabilities, missingCapabilities, hasCapability, catalogForCapability } from "./catalog";
import { scanSourceFiles, verifyFindings } from "./security";
import { githubCapabilityGap, githubPauseCapability, githubSandboxInspectHint, githubSessionInspectBranch, normalizeGitHubPath, parseGithubAttachRequest, parseGithubRepoRef, parsePrFiles, parseGithubOwnerChoiceResult, pendingGithubOwnerChoice, matchGithubOwnerReply, githubRepoNameFromLabel, conversationWantsGithubCreateRepo, conversationWantsGithubVisibility, githubCreateRepoArgsFromOwnerChoice, mergeProjectGithubRepo } from "./github-helpers";
import type { AgentContext, AgentPluginConnection } from "../types";

function context(): AgentContext {
  return {
    user: { id: "u1", name: "Ada", email: "ada@fairlx.dev" },
    workspaces: [],
    projects: [],
    workItems: [],
    notifications: [],
    githubRepos: [],
    integrations: [],
    docs: [],
  };
}

describe("capability inference", () => {
  it("requires email.send for mail prompts when no plugin is connected", () => {
    expect(inferCapabilities("Send a mail about WEB-12 to the client")).toContain("email.send");
    expect(missingCapabilities("Send a mail about WEB-12", [], context())).toContain("email.send");
  });

  it("does not require a mail plugin to invite someone by email to a project", () => {
    const query =
      "add 'fogef' to the project and this mail id is 'fogefe9321@94an.com' and make him give him role 'full stack developer' and team is developer and assign the task to him";
    expect(inferCapabilities(query)).toContain("members.invite");
    expect(inferCapabilities(query)).not.toContain("email.send");
    expect(missingCapabilities(query, [], context())).toEqual([]);
  });

  it("still requires email.send when the user asked to send email, even if an address is present", () => {
    expect(inferCapabilities("Send a mail to ada@x.com about WEB-12")).toContain("email.send");
  });

  it("does not require GitHub for planning documentation", () => {
    expect(inferCapabilities("create project documentation for this app")).not.toContain("code.read");
  });

  it("treats linked GitHub repos as code.read only when the user also connected GitHub", () => {
    const ctx = context();
    ctx.githubRepos = [{ id: "r1", owner: "acme", repositoryName: "app", branch: "main" }];
    expect(hasCapability([], ctx, "code.read")).toBe(false);
    ctx.githubAccount = { connected: true, login: "ada" };
    expect(hasCapability([], ctx, "code.read")).toBe(true);
    expect(missingCapabilities("read the repo file", [], ctx)).toEqual([]);
  });

  it("does not treat a pending GitHub stub as code.read", () => {
    const ctx = context();
    ctx.githubRepos = [{ id: "r1", githubUrl: "pending", projectId: "p1" }];
    expect(hasCapability([], ctx, "code.read")).toBe(false);
  });

  it("does not treat pending/pending owner placeholders as a linked repo", () => {
    const ctx = context();
    ctx.githubRepos = [{ id: "r1", owner: "pending", repositoryName: "pending", githubUrl: "pending", projectId: "p1" }];
    expect(hasCapability([], ctx, "code.read")).toBe(false);
    expect(hasCapability([], ctx, "code.write")).toBe(false);
  });

  it("does not treat a leftover GitHub plugin as code.write without a profile account", () => {
    const ctx = context();
    const plugins: AgentPluginConnection[] = [
      {
        id: "p1",
        catalogId: "github",
        displayName: "GitHub",
        capabilities: ["code.read", "code.write", "security.review"],
        status: "connected",
        authKind: "token",
        createdAt: new Date().toISOString(),
      },
    ];
    expect(hasCapability(plugins, ctx, "code.write")).toBe(false);
  });

  it("grants code.write when a GitHub account is connected without a linked repo", () => {
    const ctx = context();
    ctx.githubAccount = { connected: true, login: "surendra" };
    expect(hasCapability([], ctx, "code.write")).toBe(true);
    expect(hasCapability([], ctx, "code.read")).toBe(false);
  });

  it("does not pause create-repo for GitHub login identity without a stored PAT", () => {
    const ctx = context();
    ctx.githubAccount = { connected: true, login: "surendra", hasRepoAccess: false };
    expect(hasCapability([], ctx, "code.write")).toBe(true);
    expect(missingCapabilities("Create a github repo and add a detailed README.", [], ctx)).toEqual([]);
  });

  it("offers GitHub PAT connect for code.write when no repo is linked", () => {
    const items = catalogForCapability("code.write");
    expect(items.some((item) => item.id === "github")).toBe(true);
  });
});

describe("security scanner", () => {
  it("drops findings without a path after verification", () => {
    const scanned = scanSourceFiles([
      { path: "src/db.ts", content: 'const query = "SELECT * FROM users WHERE id=" + userId' },
      { path: "", content: "innerHTML = x" },
    ]);
    const verified = verifyFindings(scanned);
    expect(verified.length).toBeGreaterThan(0);
    expect(verified.every((item) => item.verified && item.path)).toBe(true);
  });
});

describe("github helpers", () => {
  it("maps missing-token errors to code.write", () => {
    expect(githubCapabilityGap({ error: "GitHub token is missing or cannot push." })).toBe("code.write");
    expect(githubCapabilityGap({ html_url: "https://github.com/x" })).toBeUndefined();
    expect(githubCapabilityGap({ error: "No GitHub repository is linked.", skipped: true })).toBeUndefined();
    expect(githubCapabilityGap({ error: "No GitHub repository is linked.", skipped: true, capability: "code.write" })).toBeUndefined();
  });

  it("parses PR file batches", () => {
    expect(parsePrFiles([{ path: "a.ts", content: "x" }, { path: "", content: "y" }])).toEqual([
      { path: "a.ts", content: "x", message: undefined },
    ]);
  });

  it("does not pause for GitHub OAuth when the Fairlx profile is already connected", () => {
    expect(
      githubPauseCapability(true, {
        error: "Connect your GitHub account to your Fairlx profile. Sign in with GitHub or paste a PAT with repo and read:org.",
        capability: "code.write",
      }),
    ).toBeUndefined();
    expect(githubPauseCapability(false, { error: "GitHub token is missing or cannot push." })).toBe("code.write");
  });

  it("pauses when a connected GitHub token is rejected", () => {
    expect(
      githubPauseCapability(true, {
        error: "Failed to fetch contents: Unauthorized",
        code: "github_auth_required",
      }),
    ).toBe("code.write");
    expect(githubCapabilityGap({ error: "Failed to fetch contents: Unauthorized" })).toBe("code.write");
  });

  it("does not treat a missing GitHub path as a plugin gap", () => {
    expect(githubCapabilityGap({ error: "Path not found in repository: src/middleware.ts on main", missing: true })).toBeUndefined();
    expect(githubCapabilityGap({ missing: true, skipped: true, items: [] })).toBeUndefined();
  });

  it("uses the coding session head branch for GitHub inspect, not main", () => {
    expect(githubSessionInspectBranch({ status: "running", headBranch: "fairlx/epic2" })).toBe("fairlx/epic2");
    expect(githubSessionInspectBranch({ status: "merged", headBranch: "fairlx/epic2" })).toBeUndefined();
    expect(githubSessionInspectBranch({ status: "running" })).toBeUndefined();
    expect(
      githubSandboxInspectHint({ sandboxBound: true, branch: "fairlx/epic2", path: "src" }),
    ).toMatch(/coding_session_exec/);
    expect(githubSandboxInspectHint({ sandboxBound: false, branch: "main", path: "src" })).toBeUndefined();
  });

  it("parses connect-repo phrasing for attach", () => {
    expect(parseGithubAttachRequest("now connect the repo Fairlx-Dev from ancientinsane")).toEqual({
      owner: "ancientinsane",
      repo: "Fairlx-Dev",
    });
    expect(parseGithubAttachRequest("connect ANCIENTINSANE/Fairlx-Dev to this project")).toEqual({
      owner: "ANCIENTINSANE",
      repo: "Fairlx-Dev",
    });
  });

  it("parses owner/repo repoIds and normalizes paths", () => {
    expect(parseGithubRepoRef("ANCIENTINSANE/SchoolStacker")).toEqual({ owner: "ANCIENTINSANE", repo: "SchoolStacker" });
    expect(parseGithubRepoRef("https://github.com/ANCIENTINSANE/SchoolStacker.git")).toEqual({
      owner: "ANCIENTINSANE",
      repo: "SchoolStacker",
    });
    expect(parseGithubRepoRef("6a9c7cbb003521e98c55")).toBeUndefined();
    expect(normalizeGitHubPath("/src/lib/auth.ts")).toBe("src/lib/auth.ts");
    expect(normalizeGitHubPath("src/app/%28portal%29")).toBe("src/app/(portal)");
  });

  it("matches an owner-choice reply after github_list_owners", () => {
    const result = JSON.stringify({
      needsOwnerChoice: true,
      githubLogin: "ANCIENTINSANE",
      owners: [
        { login: "ANCIENTINSANE", type: "User" },
        { login: "stemlen", type: "Organization" },
      ],
    });
    expect(parseGithubOwnerChoiceResult(result)?.owners.map((item) => item.login)).toEqual([
      "ANCIENTINSANE",
      "stemlen",
    ]);
    expect(
      pendingGithubOwnerChoice([
        { role: "tool", content: result },
        { role: "user", content: "ANCIENTINSANE" },
      ])?.owners[0]?.login,
    ).toBe("ANCIENTINSANE");
    expect(
      matchGithubOwnerReply("ANCIENTINSANE", [
        { login: "ANCIENTINSANE", type: "User" },
        { login: "stemlen", type: "Organization" },
      ]),
    ).toBe("ANCIENTINSANE");
    expect(conversationWantsGithubCreateRepo("Create a github repo and add a detailed README")).toBe(true);
    expect(githubRepoNameFromLabel("Fairlx")).toBe("fairlx");
    expect(githubCreateRepoArgsFromOwnerChoice({ owner: "ANCIENTINSANE", projectName: "Fairlx" })).toEqual({
      owner: "ANCIENTINSANE",
      name: "fairlx",
      autoInit: true,
      linkToProject: true,
      private: true,
      description: "Fairlx managed in Fairlx",
    });
    expect(conversationWantsGithubVisibility("make it private")).toBe("private");
  });

  it("merges a newly created repo onto the current project context", () => {
    const ctx = mergeProjectGithubRepo(context(), {
      projectId: "p1",
      owner: "ANCIENTINSANE",
      repo: "fairlx",
      githubUrl: "https://github.com/ANCIENTINSANE/fairlx",
    });
    expect(ctx.githubRepos).toEqual([
      expect.objectContaining({
        owner: "ANCIENTINSANE",
        repositoryName: "fairlx",
        projectId: "p1",
      }),
    ]);
  });
});
