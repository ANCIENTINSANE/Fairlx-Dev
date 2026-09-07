import { describe, expect, it } from "vitest";
import { jwtToAuthContext } from "../auth/context";
import { PERMISSIONS, type McpRuntime } from "../runtime/types";
import { callTool } from "./index";

function sessionRuntime() {
  const sessions: Record<string, unknown>[] = [];
  const workItems = [
    {
      $id: "wi_1",
      key: "WEB-1",
      title: "Fix login",
      projectId: "proj_1",
      workspaceId: "ws_1",
      status: "TODO",
    },
  ];
  const runtime = {
    collections: {
      workItems: "work_items",
      projects: "projects",
      codingSessions: "agent_coding_sessions",
    },
    store: {
      list: async (collection: string, queries: Array<{ type: string; field?: string; value?: unknown }>) => {
        let filtered = collection === "agent_coding_sessions" ? sessions : workItems;
        for (const query of queries) {
          if (query.type === "equal" && query.field) {
            filtered = filtered.filter((doc) => String(doc[query.field as string] ?? "") === String(query.value));
          }
        }
        return { documents: filtered, total: filtered.length };
      },
      get: async (collection: string, id: string) => {
        if (collection === "projects") return { $id: "proj_1", workspaceId: "ws_1", name: "App" };
        const table = collection === "agent_coding_sessions" ? sessions : workItems;
        const doc = table.find((item) => item.$id === id);
        if (!doc) throw new Error("missing");
        return doc;
      },
      create: async (collection: string, data: Record<string, unknown>) => {
        const doc = { $id: `${collection}_${sessions.length + 1}`, ...data };
        if (collection === "agent_coding_sessions") sessions.push(doc);
        return doc;
      },
      update: async (collection: string, id: string, data: Record<string, unknown>) => {
        const doc = sessions.find((item) => item.$id === id);
        if (!doc) throw new Error("missing");
        Object.assign(doc, data);
        return doc;
      },
    },
    resolveUserProjectAccess: async () => ({
      hasAccess: true,
      isOwner: true,
      isAdmin: true,
      permissions: [PERMISSIONS.EDIT_TASKS, PERMISSIONS.VIEW_TASKS, PERMISSIONS.CREATE_COMMENTS],
      role: "ADMIN",
    }),
    hasProjectPermission: () => true,
  } as unknown as McpRuntime;
  return { runtime, sessions };
}

const auth = jwtToAuthContext("admin_1", {
  workspaceId: "ws_1",
  projectId: "proj_1",
  scopes: ["tasks:write", "tasks:read", "comments:write"],
});

describe("fairlx coding session MCP tools", () => {
  it("starts, comments, and requests merge on a session object", async () => {
    const { runtime, sessions } = sessionRuntime();
    const started = await callTool("fairlx_coding_session_start", { workItemId: "WEB-1" }, runtime, auth);
    const startedText = started.content[0]?.text ?? "";
    expect(startedText).toMatch(/queued/i);
    expect(sessions).toHaveLength(1);

    const sessionId = String(sessions[0]?.$id);
    const commented = await callTool(
      "fairlx_coding_session_comment",
      { sessionId, body: "Fix the native tooltip", path: "src/ui.tsx", line: 12 },
      runtime,
      auth,
    );
    expect(commented.content[0]?.text).toMatch(/iterating/);

    const merge = await callTool("fairlx_coding_session_merge", { sessionId }, runtime, auth);
    expect(merge.content[0]?.text).toMatch(/merging/);
  });
});
