import { describe, expect, it } from "vitest";
import { jwtToAuthContext } from "../auth/context";
import { PERMISSIONS, type McpRuntime } from "../runtime/types";
import { callTool } from "./index";

function githubRuntime(options?: { connected?: boolean }) {
  const runtime = {
    collections: {
      githubRepos: "github_repos",
      projects: "projects",
    },
    store: {
      list: async () => ({ documents: [], total: 0 }),
      get: async () => ({ $id: "proj_1", workspaceId: "ws_1", name: "Fairlx" }),
    },
    resolveUserProjectAccess: async () => ({
      hasAccess: true,
      isOwner: true,
      isAdmin: true,
      permissions: [PERMISSIONS.VIEW_PROJECT],
      role: "ADMIN",
    }),
    hasProjectPermission: () => true,
    listGithubAccountRepos: async ({ query }: { query?: string }) => {
      if (options?.connected === false) return { connected: false, repositories: [] };
      const all = [
        {
          name: "Fairlx-Dev",
          fullName: "ANCIENTINSANE/Fairlx-Dev",
          url: "https://github.com/ANCIENTINSANE/Fairlx-Dev",
          private: true,
          defaultBranch: "main",
          source: "github_account" as const,
        },
        {
          name: "notes",
          fullName: "ANCIENTINSANE/notes",
          url: "https://github.com/ANCIENTINSANE/notes",
          private: false,
          defaultBranch: "main",
          source: "github_account" as const,
        },
      ];
      const q = (query || "").toLowerCase();
      return {
        connected: true,
        githubLogin: "ANCIENTINSANE",
        repositories: q ? all.filter((repo) => repo.fullName.toLowerCase().includes(q)) : all,
      };
    },
  } as unknown as McpRuntime;
  return runtime;
}

const auth = jwtToAuthContext("admin_1", {
  workspaceId: "ws_1",
  projectId: "proj_1",
  scopes: ["project:read"],
});

describe("fairlx_github_repo_list", () => {
  it("returns GitHub.com repos when the account is connected even with no Fairlx attachment", async () => {
    const result = await callTool("fairlx_github_repo_list", { projectId: "proj_1", query: "Fairlx" }, githubRuntime(), auth);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      accountConnected?: boolean;
      total?: number;
      repositories?: Array<{ fullName?: string }>;
    };
    expect(payload.accountConnected).toBe(true);
    expect(payload.total).toBe(1);
    expect(payload.repositories?.[0]?.fullName).toBe("ANCIENTINSANE/Fairlx-Dev");
  });

  it("does not treat an empty Fairlx attachment list as a disconnected GitHub account", async () => {
    const result = await callTool("fairlx_github_repo_list", { projectId: "proj_1" }, githubRuntime(), auth);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      accountConnected?: boolean;
      hint?: string;
      total?: number;
    };
    expect(payload.accountConnected).toBe(true);
    expect(payload.total).toBeGreaterThan(0);
    expect(payload.hint).toMatch(/do not say GitHub is disconnected/i);
  });

  it("keeps accountConnected when GitHub login is linked but no repos are returned", async () => {
    const runtime = githubRuntime();
    runtime.listGithubAccountRepos = async () => ({
      connected: true,
      githubLogin: "ANCIENTINSANE",
      repositories: [],
      hint: "Signed into Fairlx with GitHub. Do not say GitHub is disconnected.",
    });
    const result = await callTool("fairlx_github_repo_list", { projectId: "proj_1", query: "Fairlx" }, runtime, auth);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      accountConnected?: boolean;
      hint?: string;
      total?: number;
    };
    expect(payload.accountConnected).toBe(true);
    expect(payload.total).toBe(0);
    expect(payload.hint).toMatch(/do not say GitHub is disconnected/i);
  });
});
