import { describe, expect, it } from "vitest";
import { jwtToAuthContext } from "../auth/context";
import { PERMISSIONS, type McpRuntime } from "../runtime/types";
import { callTool } from "./index";

function runtime(request: McpRuntime["githubRequest"]): McpRuntime {
  return {
    collections: { githubRepos: "github_repos", projects: "projects" },
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
    githubRequest: request,
  } as unknown as McpRuntime;
}

const auth = jwtToAuthContext("admin_1", {
  workspaceId: "ws_1",
  projectId: "proj_1",
  scopes: ["project:read"],
});

describe("fairlx_github_repo_update", () => {
  it("patches repository visibility to private", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const result = await callTool(
      "fairlx_github_repo_update",
      { owner: "ANCIENTINSANE", repo: "agent-harness", private: true, projectId: "proj_1" },
      runtime(async ({ method, path, body }) => {
        calls.push({ method, path, body });
        return {
          ok: true,
          status: 200,
          data: { full_name: "ANCIENTINSANE/agent-harness", private: true, html_url: "https://github.com/ANCIENTINSANE/agent-harness" },
        };
      }),
      auth,
    );
    expect(calls[0]).toEqual({
      method: "PATCH",
      path: "/repos/ANCIENTINSANE/agent-harness",
      body: { private: true },
    });
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as { private?: boolean };
    expect(payload.private).toBe(true);
  });
});
