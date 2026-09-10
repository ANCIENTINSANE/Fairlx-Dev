import { describe, expect, it } from "vitest";

import { assigneeIdSet, workItemAssignedTo } from "./assigned-work";

describe("assigned work matching", () => {
  it("treats membership ids and user ids as the same person", () => {
    const ids = assigneeIdSet({
      userId: "user_1",
      memberships: [{ $id: "mem_1", userId: "user_1" }],
    });
    expect(workItemAssignedTo({ assigneeIds: ["mem_1"] }, ids)).toBe(true);
    expect(workItemAssignedTo({ assigneeIds: ["user_1"] }, ids)).toBe(true);
    expect(workItemAssignedTo({ assigneeIds: ["mem_other"] }, ids)).toBe(false);
    expect(workItemAssignedTo({ assigneeIds: [] }, ids)).toBe(false);
  });
});
