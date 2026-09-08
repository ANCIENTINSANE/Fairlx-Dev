import { describe, expect, it } from "vitest";
import { getSpecialistCrayonTheme } from "./crayon-underline";

describe("crayon underline themes", () => {
  it("provides distinct colors for all roster specialists", () => {
    const specialists = [
      "planner",
      "researcher",
      "builder",
      "git",
      "tester",
      "reviewer",
      "ops",
      "security",
    ];

    const themes = specialists.map((s) => ({
      specialist: s,
      ...getSpecialistCrayonTheme(s),
    }));

    // Every specialist must have a defined strokeClass
    for (const item of themes) {
      expect(item.strokeClass).toBeTruthy();
      expect(item.primaryPath).toBeTruthy();
      expect(item.secondaryPath).toBeTruthy();
    }

    // Colors must be distinct across specialists
    const colorClasses = new Set(themes.map((t) => t.strokeClass));
    expect(colorClasses.size).toBe(specialists.length);

    // Paths must not be identical across specialists (individual hand gestures)
    const paths = new Set(themes.map((t) => t.primaryPath));
    expect(paths.size).toBe(specialists.length);
  });

  it("handles case insensitivity and trims whitespace", () => {
    expect(getSpecialistCrayonTheme("  PLANNER  ").strokeClass).toContain("blue");
    expect(getSpecialistCrayonTheme("Builder").strokeClass).toContain("amber");
  });

  it("falls back gracefully for unknown specialists", () => {
    const fallback = getSpecialistCrayonTheme("unknown-custom-role");
    expect(fallback.strokeClass).toBeTruthy();
    expect(fallback.primaryPath).toBeTruthy();
  });
});
