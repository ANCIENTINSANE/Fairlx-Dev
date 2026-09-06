import { describe, expect, it } from "vitest";

import { kindsFromToolName, queryKeysForKinds } from "./fairlx-query-sync";

describe("kindsFromToolName", () => {
  it("maps project and work-item writes, including the fairlx_ prefix", () => {
    expect(kindsFromToolName("fairlx_project_create")).toEqual(
      expect.arrayContaining(["projects", "agent-context"]),
    );
    expect(kindsFromToolName("create_project")).toEqual(
      expect.arrayContaining(["projects", "agent-context"]),
    );
    expect(kindsFromToolName("fairlx_work_item_create")).toEqual(
      expect.arrayContaining(["work-items", "sprints", "agent-context"]),
    );
    expect(kindsFromToolName("fairlx_doc_create")).toEqual(
      expect.arrayContaining(["docs", "agent-context"]),
    );
    expect(kindsFromToolName("fairlx_sprint_start")).toEqual(
      expect.arrayContaining(["sprints", "work-items"]),
    );
  });

  it("ignores reads and mcp_call wrappers", () => {
    expect(kindsFromToolName("fairlx_project_list")).toEqual([]);
    expect(kindsFromToolName("fairlx_work_item_get")).toEqual([]);
    expect(kindsFromToolName("mcp_call")).toEqual([]);
    expect(kindsFromToolName("")).toEqual([]);
  });
});

describe("queryKeysForKinds", () => {
  it("dedupes overlapping prefixes", () => {
    const keys = queryKeysForKinds(["projects", "agent-context", "projects"]);
    const serialized = keys.map((key) => JSON.stringify(key));
    expect(serialized).toContain(JSON.stringify(["projects"]));
    expect(serialized).toContain(JSON.stringify(["agent-context"]));
    expect(serialized.filter((key) => key === JSON.stringify(["projects"]))).toHaveLength(1);
  });
});
