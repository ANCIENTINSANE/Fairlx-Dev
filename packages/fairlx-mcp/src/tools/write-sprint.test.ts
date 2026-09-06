import { describe, expect, it, vi } from "vitest";
import { jwtToAuthContext } from "../auth/context";
import type { McpRuntime } from "../runtime/types";
import { callTool } from "./index";

function sprintRuntime(
  existingSprints: Record<string, unknown>[] = [],
  existingItems: Record<string, unknown>[] = [],
) {
  const sprints = existingSprints.map((doc) => ({ ...doc }));
  const workItems = existingItems.map((doc) => ({ ...doc }));
  const created: Record<string, unknown>[] = [];
  const table = (collection: string) => {
    if (collection === "work_items") return workItems;
    return sprints;
  };
  const runtime = {
    collections: { sprints: "sprints", projects: "projects", workItems: "work_items" },
    store: {
      list: async (collection: string, queries: Array<{ type: string; field?: string; value?: unknown }>) => {
        let filtered = table(collection);
        for (const query of queries) {
          if (query.type === "equal" && query.field) {
            filtered = filtered.filter((doc) => doc[query.field as string] === query.value);
          }
        }
        return { documents: filtered, total: filtered.length };
      },
      get: async (collection: string, id: string) => {
        if (collection === "projects" && id === "proj_1") {
          return { $id: "proj_1", workspaceId: "ws_1", name: "School Stacker" };
        }
        const doc = table(collection).find((item) => item.$id === id);
        if (doc) return doc;
        throw new Error("missing");
      },
      create: async (collection: string, data: Record<string, unknown>) => {
        const doc = { $id: `sp_${sprints.length + created.length + 1}`, ...data };
        created.push(doc);
        if (collection === "work_items") workItems.push(doc);
        else sprints.push(doc);
        return doc;
      },
      update: async (collection: string, id: string, data: Record<string, unknown>) => {
        const doc = table(collection).find((item) => item.$id === id);
        if (!doc) throw new Error("missing");
        Object.assign(doc, data);
        return doc;
      },
      delete: async (collection: string, id: string) => {
        const rows = table(collection);
        const index = rows.findIndex((item) => item.$id === id);
        if (index >= 0) rows.splice(index, 1);
      },
    },
    resolveUserProjectAccess: async () => ({ hasAccess: true, isOwner: true, isAdmin: true }),
    hasProjectPermission: () => true,
    logAudit: vi.fn(),
  } as unknown as McpRuntime;
  return { runtime, created, sprints, workItems };
}

const auth = jwtToAuthContext("admin_1", {
  workspaceId: "ws_1",
  projectId: "proj_1",
  scopes: ["sprints:manage", "sprints:read"],
});

describe("fairlx_sprint_create", () => {
  it("starts the first sprint on a project automatically", async () => {
    const { runtime, created } = sprintRuntime();
    const result = await callTool(
      "fairlx_sprint_create",
      { projectId: "proj_1", name: "Sprint 1 — Foundation", goal: "Set up the foundation" },
      runtime,
      auth,
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.started).toBe(true);
    expect(payload.sprint.status).toBe("ACTIVE");
    expect(created[0]?.status).toBe("ACTIVE");
  });

  it("keeps later sprints planned when one already exists", async () => {
    const { runtime, created } = sprintRuntime([
      { $id: "sp_old", projectId: "proj_1", name: "Sprint 1", status: "ACTIVE" },
    ]);
    const result = await callTool(
      "fairlx_sprint_create",
      { projectId: "proj_1", name: "Sprint 2" },
      runtime,
      auth,
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.started).toBe(false);
    expect(payload.sprint.status).toBe("PLANNED");
    expect(created[0]?.status).toBe("PLANNED");
  });

  it("updates the existing sprint instead of creating a duplicate number", async () => {
    const { runtime, created } = sprintRuntime([
      { $id: "sp_old", projectId: "proj_1", name: "Sprint 1", status: "ACTIVE" },
    ]);
    const result = await callTool(
      "fairlx_sprint_create",
      {
        projectId: "proj_1",
        name: "Sprint 1 — Queen Core & Model Router",
        goal: "Ship the router",
        startDate: "2026-04-07",
        endDate: "2026-04-18",
      },
      runtime,
      auth,
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(created).toHaveLength(0);
    expect(payload.alreadyExists).toBe(true);
    expect(payload.sprint.id).toBe("sp_old");
    expect(payload.sprint.name).toBe("Sprint 1 — Queen Core & Model Router");
    expect(payload.sprint.workingDays).toBe(9);
  });
});

describe("fairlx_sprint_get", () => {
  it("resolves a sprint by name and reports build days vs capacity", async () => {
    const { runtime } = sprintRuntime([
      {
        $id: "sp_1",
        projectId: "proj_1",
        name: "Sprint 1 — Queen Core & Model Router",
        status: "ACTIVE",
        startDate: "2026-04-07",
        endDate: "2026-04-18",
      },
    ]);
    const result = await callTool(
      "fairlx_sprint_get",
      { sprintId: "Sprint 1", projectId: "proj_1" },
      runtime,
      auth,
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.sprint.id).toBe("sp_1");
    expect(payload.sprint.workingDays).toBe(9);
  });

  it("refuses a project id used as sprintId", async () => {
    const { runtime } = sprintRuntime([
      { $id: "sp_1", projectId: "proj_1", name: "Sprint 1", status: "ACTIVE" },
    ]);
    await expect(
      callTool("fairlx_sprint_get", { sprintId: "proj_1" }, runtime, auth),
    ).rejects.toThrow(/project id/i);
  });

  it("picks the ACTIVE sprint when duplicate names exist", async () => {
    const { runtime } = sprintRuntime([
      { $id: "sp_dup", projectId: "proj_1", name: "Sprint 1 — Queen Core", status: "PLANNED" },
      { $id: "sp_1", projectId: "proj_1", name: "Sprint 1 — Queen Core & Model Router", status: "ACTIVE" },
    ]);
    const result = await callTool(
      "fairlx_sprint_get",
      { sprintId: "Sprint 1", projectId: "proj_1" },
      runtime,
      auth,
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.sprint.id).toBe("sp_1");
  });
});

describe("duplicate sprint fold", () => {
  it("moves items from a duplicate Sprint 1 onto the active sprint and removes the extra row", async () => {
    const { runtime, sprints, workItems } = sprintRuntime(
      [
        {
          $id: "sp_old",
          projectId: "proj_1",
          name: "Sprint 1",
          status: "ACTIVE",
          $createdAt: "2026-04-01T00:00:00.000Z",
        },
        {
          $id: "sp_new",
          projectId: "proj_1",
          name: "Sprint 1 — Queen Core",
          status: "PLANNED",
          $createdAt: "2026-09-06T00:00:00.000Z",
        },
      ],
      [
        { $id: "wi_1", key: "AGEN-1", projectId: "proj_1", sprintId: "sp_old", title: "Router" },
        { $id: "wi_2", key: "AGEN-2", projectId: "proj_1", sprintId: "sp_new", title: "Queen" },
      ],
    );
    const result = await callTool(
      "fairlx_sprint_create",
      {
        projectId: "proj_1",
        name: "Sprint 1 — Queen Core & Model Router",
        startDate: "2026-04-07",
        endDate: "2026-04-18",
      },
      runtime,
      auth,
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.sprint.id).toBe("sp_old");
    expect(payload.foldedDuplicates).toEqual([{ id: "sp_new", name: "Sprint 1 — Queen Core" }]);
    expect(sprints.map((sprint) => sprint.$id)).toEqual(["sp_old"]);
    expect(workItems.map((item) => item.sprintId)).toEqual(["sp_old", "sp_old"]);
  });
});

describe("fairlx_sprint_plan", () => {
  it("updates Sprint 1 and creates Sprint 2 in one call", async () => {
    const { runtime, created } = sprintRuntime([
      { $id: "sp_old", projectId: "proj_1", name: "Sprint 1", status: "ACTIVE" },
    ]);
    const result = await callTool(
      "fairlx_sprint_plan",
      {
        projectId: "proj_1",
        sprints: [
          {
            name: "Sprint 1 — Queen Core & Model Router",
            startDate: "2026-04-07",
            endDate: "2026-04-18",
            goal: "Ship the router",
          },
          {
            name: "Sprint 2 — Sub-Agent Communication",
            startDate: "2026-04-21",
            endDate: "2026-05-02",
            goal: "Swarm protocol",
          },
        ],
      },
      runtime,
      auth,
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      total: number;
      sprints: { name: string; workingDays: number | null }[];
    };
    expect(created).toHaveLength(1);
    expect(payload.total).toBe(2);
    expect(payload.sprints.map((sprint) => sprint.name)).toEqual([
      "Sprint 1 — Queen Core & Model Router",
      "Sprint 2 — Sub-Agent Communication",
    ]);
    expect(payload.sprints[0]?.workingDays).toBe(9);
  });
});
