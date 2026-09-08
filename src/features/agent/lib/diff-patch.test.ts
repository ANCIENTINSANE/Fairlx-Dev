import { describe, expect, it } from "vitest";

import { collapseUnmodified, fileExtBadge, isNewFileStatus, parseUnifiedPatch } from "./diff-patch";

const SAMPLE = [
  "diff --git a/src/select.ts b/src/select.ts",
  "--- a/src/select.ts",
  "+++ b/src/select.ts",
  "@@ -10,8 +10,10 @@",
  " keep a",
  " keep b",
  "+type Bucket = { name: string };",
  "+const ALWAYS = [\"github_list_files\"];",
  " keep c",
  "+const BUCKETS = [];",
  " keep d",
  " keep e",
].join("\n");

describe("parseUnifiedPatch", () => {
  it("skips git headers and tracks add/context lines", () => {
    const lines = parseUnifiedPatch(SAMPLE);
    expect(lines.filter((line) => line.kind === "add").map((line) => line.text)).toEqual([
      "type Bucket = { name: string };",
      "const ALWAYS = [\"github_list_files\"];",
      "const BUCKETS = [];",
    ]);
    expect(lines.filter((line) => line.kind === "context")).toHaveLength(5);
  });

  it("collapses unmodified runs so the UI can expand them", () => {
    const blocks = collapseUnmodified(parseUnifiedPatch(SAMPLE));
    expect(blocks.map((block) => (block.type === "gap" ? `gap:${block.lines.length}` : `chg:${block.lines.length}`))).toEqual([
      "gap:2",
      "chg:2",
      "gap:1",
      "chg:1",
      "gap:2",
    ]);
  });

  it("returns badges for typescript files and detects new status", () => {
    expect(fileExtBadge("src/features/agent/lib/brain/select.ts").label).toBe("TS");
    expect(isNewFileStatus("added")).toBe(true);
    expect(isNewFileStatus("modified")).toBe(false);
  });
});
