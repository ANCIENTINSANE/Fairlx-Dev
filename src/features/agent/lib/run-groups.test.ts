import { describe, expect, it } from "vitest";

import { groupContainingRun, groupRunsByProject } from "./run-groups";

describe("groupRunsByProject", () => {
  it("nests chats under their project and keeps recency order", () => {
    const groups = groupRunsByProject(
      [
        { id: "r1", projectId: "p1", updatedAt: "2026-09-10T12:00:00.000Z" },
        { id: "r2", projectId: "p2", updatedAt: "2026-09-10T11:00:00.000Z" },
        { id: "r3", projectId: "p1", updatedAt: "2026-09-10T10:00:00.000Z" },
        { id: "r4", updatedAt: "2026-09-10T09:00:00.000Z" },
      ],
      [
        { id: "p1", name: "Stemlen Landing" },
        { id: "p2", name: "Fairlx" },
      ],
    );
    expect(groups.map((group) => group.projectName)).toEqual(["Stemlen Landing", "Fairlx", "No project"]);
    expect(groups[0]?.runs.map((run) => run.id)).toEqual(["r1", "r3"]);
    expect(groupContainingRun(groups, "r2")).toBe("p2");
  });
});
