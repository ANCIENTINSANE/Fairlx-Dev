import { describe, expect, it } from "vitest";

import {
  lookupWorkItem,
  mergeWorkItem,
  normalizePriority,
  normalizeStatus,
  splitMarkdownWorkItemTable,
} from "./work-item-table";

describe("splitMarkdownWorkItemTable", () => {
  it("parses kanban-style markdown tables and normalizes tags", () => {
    const parsed = splitMarkdownWorkItemTable(`
Here are the items:

| Key | Title | Status | Priority | Assignee |
| --- | --- | --- | --- | --- |
| PROJ-43 | Export timeline | Done | Medium | Surendra Mattaparthi |
| PROJ-12 | Missing owner | TODO | HIGH | Unassigned |
`);
    expect(parsed?.before).toContain("Here are the items");
    expect(parsed?.rows).toEqual([
      {
        key: "PROJ-43",
        title: "Export timeline",
        status: "DONE",
        type: "",
        priority: "MEDIUM",
        unassigned: false,
        assignees: [{ name: "Surendra Mattaparthi" }],
      },
      {
        key: "PROJ-12",
        title: "Missing owner",
        status: "TODO",
        type: "",
        priority: "HIGH",
        unassigned: true,
        assignees: [],
      },
    ]);
  });

  it("parses numbered tables with Type, Priority, and Description (proposals)", () => {
    const parsed = splitMarkdownWorkItemTable(`
Initial proposed items:

| # | Title | Type | Priority | Description | Labels |
|---|---|---|---|---|---|
| 1 | Set up project tech stack | Task | High | Configure Next.js and Tailwind | frontend, infra |
| 2 | Design database schema | Story | Urgent | Set up Appwrite collections | backend |
`);
    expect(parsed?.rows).toEqual([
      {
        key: "#1",
        title: "Set up project tech stack",
        status: "TODO",
        type: "TASK",
        priority: "HIGH",
        unassigned: true,
        assignees: [],
        labels: ["frontend", "infra"],
        description: "Configure Next.js and Tailwind",
      },
      {
        key: "#2",
        title: "Design database schema",
        status: "TODO",
        type: "STORY",
        priority: "URGENT",
        unassigned: true,
        assignees: [],
        labels: ["backend"],
        description: "Set up Appwrite collections",
      },
    ]);
  });

  it("strips wrapping markdown from keys like **SCHO-93**", () => {
    const parsed = splitMarkdownWorkItemTable(`
| Key | Title | Status | Priority | Assignee |
| --- | --- | --- | --- | --- |
| **SCHO-93** | SQL in \`tests/e2e/school-admin.spec.ts\` | Todo | Urgent | Unassigned |
| #**SCHO-96** | Changelog SQL | Todo | High | Unassigned |
`);
    expect(parsed?.rows.map((row) => row.key)).toEqual(["SCHO-93", "SCHO-96"]);
    expect(parsed?.rows[0]?.title).toContain("tests/e2e/school-admin.spec.ts");
  });
});

describe("mergeWorkItem", () => {
  it("fills type and assignee photos from the list payload", () => {
    const merged = mergeWorkItem(
      {
        key: "PROJ-43",
        title: "Export timeline",
        status: "Done",
        priority: "Medium",
        assignees: [{ name: "Surendra Mattaparthi" }],
      },
      {
        key: "PROJ-43",
        type: "BUG",
        status: "DONE",
        priority: "MEDIUM",
        assignees: [{ name: "Surendra Mattaparthi", imageUrl: "https://cdn.example/s.png" }],
      },
    );
    expect(merged).toMatchObject({
      type: "BUG",
      status: "DONE",
      priority: "MEDIUM",
      assignees: [{ name: "Surendra Mattaparthi", imageUrl: "https://cdn.example/s.png" }],
    });
  });

  it("lets tool assignees win over a markdown Unassigned cell", () => {
    const merged = mergeWorkItem(
      {
        key: "CHO-93",
        title: "SQL concatenated with user input",
        status: "TODO",
        priority: "HIGH",
        unassigned: true,
        assignees: [],
      },
      {
        key: "SCHO-93",
        title: "SQL concatenated with user input",
        unassigned: false,
        assignees: [{ name: "fogef" }],
      },
    );
    expect(merged).toMatchObject({
      key: "SCHO-93",
      unassigned: false,
      assignees: [{ name: "fogef" }],
    });
  });

  it("lets a later unassign lookup clear a markdown assignee", () => {
    const merged = mergeWorkItem(
      {
        key: "SCHO-93",
        unassigned: false,
        assignees: [{ name: "fogef" }],
      },
      {
        key: "SCHO-93",
        unassigned: true,
        assignees: [],
      },
    );
    expect(merged.unassigned).toBe(true);
    expect(merged.assignees).toEqual([]);
  });
});

describe("lookupWorkItem", () => {
  it("matches a clipped CHO-93 key to SCHO-93", () => {
    const map = new Map([
      ["SCHO-93", { key: "SCHO-93", unassigned: false, assignees: [{ name: "fogef" }] }],
    ]);
    expect(lookupWorkItem(map, "CHO-93")?.assignees).toEqual([{ name: "fogef" }]);
  });
});

describe("normalize tags", () => {
  it("maps human labels to board enums", () => {
    expect(normalizeStatus("In Progress")).toBe("IN_PROGRESS");
    expect(normalizePriority("urgent")).toBe("URGENT");
    expect(normalizePriority("— 🔴 high")).toBe("HIGH");
    expect(normalizePriority("🔴 high")).toBe("HIGH");
    expect(normalizePriority("— 🟡 medium")).toBe("MEDIUM");
    expect(normalizePriority("🟡 medium")).toBe("MEDIUM");
    expect(normalizePriority("🟢 low")).toBe("LOW");
    expect(normalizePriority("🔥 urgent")).toBe("URGENT");
    expect(normalizeStatus("🟡 In Progress")).toBe("IN_PROGRESS");
    expect(normalizeStatus("✅ Done")).toBe("DONE");
  });
});
