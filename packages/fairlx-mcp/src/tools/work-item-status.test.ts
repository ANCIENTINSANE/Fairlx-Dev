import { describe, expect, it } from "vitest";

import { resolveWorkItemStatus } from "./work-item-status";

describe("resolveWorkItemStatus", () => {
  it("maps Assigned column labels to ASSIGNED", () => {
    expect(resolveWorkItemStatus("Assigned")).toBe("ASSIGNED");
    expect(resolveWorkItemStatus("assigned column")).toBe("ASSIGNED");
    expect(resolveWorkItemStatus("ASSIGNED")).toBe("ASSIGNED");
  });

  it("prefers the workflow status key when the board uses a custom name", () => {
    expect(
      resolveWorkItemStatus("Assigned", [{ key: "ASSIGNED", name: "Assigned" }]),
    ).toBe("ASSIGNED");
    expect(
      resolveWorkItemStatus("Selected", [{ key: "SELECTED", name: "Selected for Sprint" }]),
    ).toBe("SELECTED");
  });
});
