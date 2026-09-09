import { describe, expect, it } from "vitest";

import {
  attachmentRejectReason,
  chipFromFile,
  chipsFromFiles,
  isRasterImageFile,
  isVideoAttachment,
  isWordAttachment,
} from "./attach-files";

const TINY_PNG_BYTES = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (char) => char.charCodeAt(0),
);

describe("agent attachments", () => {
  it("rejects video and Word documents", () => {
    expect(isVideoAttachment("clip.mp4", "video/mp4")).toBe(true);
    expect(isVideoAttachment("clip.mov", "")).toBe(true);
    expect(isWordAttachment("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(
      true,
    );
    expect(isWordAttachment("memo.doc", "application/msword")).toBe(true);
    expect(attachmentRejectReason({ name: "clip.mp4", type: "video/mp4" })).toMatch(/Videos/i);
    expect(attachmentRejectReason({ name: "brief.docx", type: "" })).toMatch(/Word/i);
    expect(attachmentRejectReason({ name: "shot.png", type: "image/png" })).toBeNull();
    expect(attachmentRejectReason({ name: "spec.md", type: "text/markdown" })).toBeNull();
  });

  it("treats raster images as vision chips with a data URL", async () => {
    expect(isRasterImageFile("shot.png", "image/png")).toBe(true);
    expect(isRasterImageFile("icon.svg", "image/svg+xml")).toBe(false);
    const file = new File([TINY_PNG_BYTES], "shot.png", { type: "image/png" });
    const chip = await chipFromFile(file);
    expect(chip.kind).toBe("image");
    expect(chip.content?.startsWith("data:image/")).toBe(true);
  });

  it("does not attach video or Word files", async () => {
    const { chips, errors } = await chipsFromFiles([
      new File(["fake"], "demo.mp4", { type: "video/mp4" }),
      new File(["fake"], "notes.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ]);
    expect(chips).toEqual([]);
    expect(errors.some((message) => /Videos/i.test(message))).toBe(true);
    expect(errors.some((message) => /Word/i.test(message))).toBe(true);
  });
});
