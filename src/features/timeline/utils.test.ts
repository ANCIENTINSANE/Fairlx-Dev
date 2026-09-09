import { describe, expect, it } from "vitest";
import { groupItemsBySprintAndEpic, flattenTimelineItems, workItemToTimelineItem } from "./utils";
import {
  WorkItemType,
  WorkItemStatus,
  WorkItemPriority,
  PopulatedWorkItem,
  PopulatedSprint,
} from "../sprints/types";

function makeEpic(overrides: Partial<PopulatedWorkItem> & { $id: string }): PopulatedWorkItem {
  return {
    $createdAt: "",
    $updatedAt: "",
    workspaceId: "ws1",
    projectId: "p1",
    key: overrides.key || "EPIC-1",
    title: overrides.title || "Parent Epic",
    type: WorkItemType.EPIC,
    status: WorkItemStatus.TODO,
    priority: WorkItemPriority.MEDIUM,
    assigneeIds: [],
    ...overrides,
  } as PopulatedWorkItem;
}

function makeTask(overrides: Partial<PopulatedWorkItem> & { $id: string }): PopulatedWorkItem {
  return {
    $createdAt: "",
    $updatedAt: "",
    workspaceId: "ws1",
    projectId: "p1",
    key: overrides.key || "TASK-1",
    title: overrides.title || "Sprint Task",
    type: WorkItemType.TASK,
    status: WorkItemStatus.TODO,
    priority: WorkItemPriority.MEDIUM,
    assigneeIds: [],
    ...overrides,
  } as PopulatedWorkItem;
}

describe("groupItemsBySprintAndEpic", () => {
  it("does not duplicate an unscheduled epic as a full bar inside a sprint", () => {
    const sprint = {
      $id: "sprint-1",
      name: "Sprint 1",
      status: "ACTIVE",
      workspaceId: "ws1",
      projectId: "p1",
      startDate: "2026-01-01",
      endDate: "2026-01-14",
      $createdAt: "",
      $updatedAt: "",
    } as PopulatedSprint;

    const epic = makeEpic({ $id: "epic-1", sprintId: null, key: "EPIC-1", title: "Platform" });
    const task = makeTask({
      $id: "task-1",
      sprintId: "sprint-1",
      epicId: "epic-1",
      key: "TASK-1",
    });

    const expanded = new Set(["unscheduled", "sprint-1", "epic-1", "epic-label-epic-1-sprint-1"]);
    const groups = groupItemsBySprintAndEpic([sprint], [epic, task], expanded);

    const unscheduled = groups.find((g) => g.sprint.$id === "unscheduled");
    expect(unscheduled?.epics.some((e) => e.epic.id === "epic-1")).toBe(true);

    const sprintGroup = groups.find((g) => g.sprint.$id === "sprint-1");
    expect(sprintGroup).toBeTruthy();

    const sprintEpicRows = sprintGroup!.epics.filter((e) => e.epic.type === WorkItemType.EPIC);
    expect(sprintEpicRows).toHaveLength(1);
    expect(sprintEpicRows[0].epic.isLabelOnly).toBe(true);
    expect(sprintEpicRows[0].epic.id).toBe("epic-label-epic-1-sprint-1");
    expect(sprintEpicRows[0].tasks.map((t) => t.id)).toEqual(["task-1"]);

    // Flat grid must not include the real epic id twice / under the sprint
    const flat = flattenTimelineItems(
      groups.map((g) => ({ ...g, isExpanded: true, epics: g.epics.map((e) => ({ ...e, isExpanded: true })) }))
    );
    const epicBars = flat.filter((i) => i.id === "epic-1");
    expect(epicBars).toHaveLength(1);
    expect(flat.some((i) => i.id === "epic-label-epic-1-sprint-1")).toBe(false);
  });

  it("keeps a full epic row when the epic itself is in the sprint", () => {
    const sprint = {
      $id: "sprint-1",
      name: "Sprint 1",
      status: "ACTIVE",
      workspaceId: "ws1",
      projectId: "p1",
      startDate: "2026-01-01",
      endDate: "2026-01-14",
      $createdAt: "",
      $updatedAt: "",
    } as PopulatedSprint;

    const epic = makeEpic({ $id: "epic-1", sprintId: "sprint-1" });
    const task = makeTask({ $id: "task-1", sprintId: "sprint-1", epicId: "epic-1" });

    const groups = groupItemsBySprintAndEpic(
      [sprint],
      [epic, task],
      new Set(["sprint-1", "epic-1"])
    );
    const sprintGroup = groups.find((g) => g.sprint.$id === "sprint-1");
    const epicRow = sprintGroup!.epics.find((e) => e.epic.id === "epic-1");
    expect(epicRow).toBeTruthy();
    expect(epicRow!.epic.isLabelOnly).toBeFalsy();
  });
});

describe("workItemToTimelineItem dates", () => {
  it("does not invent start or due dates for unscheduled items with no sprint work", () => {
    const item = makeTask({
      $id: "task-1",
      $createdAt: "2026-01-15T10:00:00.000Z",
      sprintId: null,
    });

    const timeline = workItemToTimelineItem(item);

    expect(timeline.startDate).toBeUndefined();
    expect(timeline.dueDate).toBeUndefined();
    expect(timeline.hasExplicitDates).toBe(false);
  });

  it("keeps real start and due dates when they are set", () => {
    const item = makeTask({
      $id: "task-1",
      startDate: "2026-03-01",
      dueDate: "2026-03-10",
      $createdAt: "2026-01-15T10:00:00.000Z",
    });

    const timeline = workItemToTimelineItem(item);

    expect(timeline.startDate).toBe("2026-03-01");
    expect(timeline.dueDate).toBe("2026-03-10");
    expect(timeline.hasExplicitDates).toBe(true);
  });

  it("uses sprint dates when the item has no dates of its own", () => {
    const item = makeTask({
      $id: "task-1",
      $createdAt: "2026-01-15T10:00:00.000Z",
    });

    const timeline = workItemToTimelineItem(item, 0, new Set(), {
      startDate: "2026-02-01",
      endDate: "2026-02-14",
    });

    expect(timeline.startDate).toBe("2026-02-01");
    expect(timeline.dueDate).toBe("2026-02-14");
    expect(timeline.hasExplicitDates).toBe(false);
  });

  it("prefers sprint deadlines over a due date without a start date", () => {
    const item = makeTask({
      $id: "task-1",
      dueDate: "2025-07-18T00:00:00.000+00:00",
      sprintId: "sprint-1",
    });

    const timeline = workItemToTimelineItem(item, 0, new Set(), {
      startDate: "2026-09-01",
      endDate: "2026-09-26",
    });

    expect(timeline.startDate).toBe("2026-09-01");
    expect(timeline.dueDate).toBe("2026-09-26");
    expect(timeline.hasExplicitDates).toBe(false);
  });

  it("gives an unscheduled epic a bar from its children's sprint dates", () => {
    const sprint = {
      $id: "sprint-1",
      name: "Sprint 1",
      status: "ACTIVE",
      workspaceId: "ws1",
      projectId: "p1",
      startDate: "2026-09-01",
      endDate: "2026-09-26",
      $createdAt: "",
      $updatedAt: "",
    } as PopulatedSprint;

    const epic = makeEpic({ $id: "epic-1", sprintId: null, key: "AGEN-1" });
    const task = makeTask({
      $id: "task-1",
      sprintId: "sprint-1",
      epicId: "epic-1",
      dueDate: "2025-07-18T00:00:00.000+00:00",
    });

    const timeline = workItemToTimelineItem(epic, 1, new Set(), null, {
      workItems: [epic, task],
      sprints: [sprint],
    });

    expect(timeline.startDate).toBe("2026-09-01");
    expect(timeline.dueDate).toBe("2026-09-26");
    expect(timeline.hasExplicitDates).toBe(false);
  });
});
