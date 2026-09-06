import { describe, expect, it } from "vitest";
import {
  estimatedBuildDays,
  findSprintForCreate,
  sprintNameMatches,
  workingDaysBetween,
} from "./sprint-resolve";

describe("workingDaysBetween", () => {
  it("counts weekdays in a two-week sprint window", () => {
    expect(workingDaysBetween("2026-04-07", "2026-04-18")).toBe(9);
  });

  it("returns null when dates are missing", () => {
    expect(workingDaysBetween("2026-04-07", null)).toBeNull();
  });
});

describe("estimatedBuildDays", () => {
  it("treats one story point as half a day", () => {
    expect(estimatedBuildDays(10)).toBe(5);
    expect(estimatedBuildDays(3)).toBe(1.5);
  });
});

describe("sprintNameMatches", () => {
  it("matches a numbered sprint to a titled sprint", () => {
    expect(sprintNameMatches("Sprint 1 — Queen Core & Model Router", "Sprint 1")).toBe(true);
    expect(sprintNameMatches("Sprint 1 — Queen Core & Model Router", "1")).toBe(true);
    expect(sprintNameMatches("Sprint 2", "Sprint 1")).toBe(false);
  });
});

describe("findSprintForCreate", () => {
  it("reuses the same sprint number instead of creating a duplicate", () => {
    const existing = [
      { $id: "sp_1", name: "Sprint 1" },
      { $id: "sp_2", name: "Sprint 2 — Swarm" },
    ];
    expect(findSprintForCreate(existing, "Sprint 1 — Queen Core")?.$id).toBe("sp_1");
    expect(findSprintForCreate(existing, "Sprint 2")?.$id).toBe("sp_2");
    expect(findSprintForCreate(existing, "Sprint 3")).toBeUndefined();
  });

  it("prefers the ACTIVE original over a newer duplicate", () => {
    const existing = [
      {
        $id: "sp_new",
        name: "Sprint 1 — Queen Core",
        status: "PLANNED",
        $createdAt: "2026-09-06T12:00:00.000Z",
      },
      {
        $id: "sp_old",
        name: "Sprint 1",
        status: "ACTIVE",
        $createdAt: "2026-04-01T12:00:00.000Z",
      },
    ];
    expect(findSprintForCreate(existing, "Sprint 1 — Queen Core & Model Router")?.$id).toBe("sp_old");
  });
});
