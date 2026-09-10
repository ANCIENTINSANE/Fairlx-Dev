import { describe, expect, it } from "vitest";

import {
  applyShortcutAtCaret,
  detectComposerTrigger,
  expandComposerShortcuts,
  filterShortcuts,
  stripComposerShortcuts,
} from "./composer-shortcuts";

describe("composer shortcuts", () => {
  it("detects / and @ at the caret", () => {
    expect(detectComposerTrigger("/pl", 3)).toEqual({ kind: "slash", query: "pl", start: 0, end: 3 });
    expect(detectComposerTrigger("add @bu", 7)?.kind).toBe("at");
    expect(detectComposerTrigger("hello world", 11)).toBeNull();
  });

  it("filters slash commands", () => {
    expect(filterShortcuts("slash", "pre").map((item) => item.id)).toEqual(["preview"]);
    expect(filterShortcuts("at", "build").map((item) => item.id)).toContain("builder");
  });

  it("expands /plan into a model instruction and strips it for display", () => {
    const expanded = expandComposerShortcuts("/plan add a hamburger menu");
    expect(expanded.mode).toBe("plan");
    expect(expanded.text).toMatch(/\[Shortcut \/plan\]/);
    expect(expanded.text).toMatch(/hamburger menu/);
    expect(stripComposerShortcuts(expanded.text)).toBe("add a hamburger menu");
  });

  it("keeps unknown tokens and expands several shortcuts", () => {
    const expanded = expandComposerShortcuts("/plan @builder add a hamburger menu /notacommand");
    expect(expanded.mode).toBe("plan");
    expect(expanded.text).toMatch(/\[Shortcut \/plan\]/);
    expect(expanded.text).toMatch(/\[Shortcut @builder\]/);
    expect(expanded.text).toMatch(/\/notacommand/);
  });

  it("applies a shortcut at the caret", () => {
    const next = applyShortcutAtCaret("/pl", 3, filterShortcuts("slash", "plan")[0]!);
    expect(next.text.startsWith("/plan ")).toBe(true);
  });
});
