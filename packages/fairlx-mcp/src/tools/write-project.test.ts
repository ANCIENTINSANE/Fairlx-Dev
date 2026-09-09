import { describe, expect, it, vi } from "vitest";

import { jwtToAuthContext } from "../auth/context";
import { callTool } from "./index";
import type { McpRuntime } from "../runtime/types";

describe("fairlx_project_create", () => {
  it("creates the project and seeds owner roles even with an idempotency key", async () => {
    const created: Record<string, unknown>[] = [];
    const onProjectCreated = vi.fn();
    const runtime = {
      collections: { projects: "projects", members: "members" },
      store: {
        list: async () => ({
          documents: [{ $id: "mem_1", userId: "user_1", workspaceId: "ws_1" }],
          total: 1,
        }),
        create: async (_collection: string, data: Record<string, unknown>) => {
          const doc = { $id: "proj_new", ...data };
          created.push(doc);
          return doc;
        },
      },
      onProjectCreated,
      getIdempotencyResult: vi.fn().mockRejectedValue(new Error("Connection is closed.")),
      acquireIdempotencyLock: vi.fn().mockResolvedValue(true),
      recordIdempotency: vi.fn().mockRejectedValue(new Error("Connection is closed.")),
      logAudit: vi.fn(),
    } as unknown as McpRuntime;

    const result = await callTool(
      "fairlx_project_create",
      {
        workspaceId: "ws_1",
        name: "PPT Generator",
        description: "AI PowerPoint generator",
        boardType: "SCRUM",
        confirm: true,
        idempotencyKey: "create-ppt-generator-project",
      },
      runtime,
      jwtToAuthContext("user_1", { workspaceId: "ws_1", scopes: ["project:write"] }),
    );

    expect(created[0]).toMatchObject({ name: "PPT Generator", workspaceId: "ws_1" });
    expect(onProjectCreated).toHaveBeenCalledWith({
      projectId: "proj_new",
      workspaceId: "ws_1",
      userId: "user_1",
      name: "PPT Generator",
    });
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      project: { id: "proj_new", name: "PPT Generator" },
    });
  });
});
