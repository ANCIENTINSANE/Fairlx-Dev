import { describe, expect, it } from "vitest";

import {
  extractAttachedImages,
  formatAttachedImages,
  hasFullAttachedImages,
  keepLatestImages,
  stubAttachedImages,
  stripAttachedImages,
  userContentForChatCompletions,
} from "./attach-images";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("attached images", () => {
  it("round-trips fenced image data URLs and hides them from display text", () => {
    const packed = formatAttachedImages([{ name: "shot.png", mime: "image/png", dataUrl: TINY_PNG }]);
    expect(extractAttachedImages(packed)).toEqual([
      { name: "shot.png", mime: "image/png", dataUrl: TINY_PNG, omitted: false },
    ]);
    expect(stripAttachedImages(`${packed}\n\nWhat's in this screenshot?`)).toBe("What's in this screenshot?");
    expect(hasFullAttachedImages(packed)).toBe(true);
  });

  it("maps image fences onto chat completion vision parts", () => {
    const packed = `${formatAttachedImages([{ name: "ui.png", mime: "image/png", dataUrl: TINY_PNG }])}\n\nMove this bar.`;
    expect(userContentForChatCompletions(packed)).toEqual([
      { type: "text", text: "Move this bar." },
      { type: "image_url", image_url: { url: TINY_PNG } },
    ]);
  });

  it("stubs older image bytes and keeps the latest screenshot", () => {
    const first = `${formatAttachedImages([{ name: "one.png", mime: "image/png", dataUrl: TINY_PNG }])}\n\nFirst`;
    const second = `${formatAttachedImages([{ name: "two.png", mime: "image/png", dataUrl: TINY_PNG }])}\n\nSecond`;
    const next = keepLatestImages([
      { role: "user", content: first },
      { role: "assistant", content: "ok" },
      { role: "user", content: second },
    ]);
    expect(hasFullAttachedImages(next[0]!.content)).toBe(false);
    expect(next[0]!.content).toContain("omitted");
    expect(hasFullAttachedImages(next[2]!.content)).toBe(true);
    expect(stripAttachedImages(stubAttachedImages(first), true)).toContain("[Attached image: one.png]");
  });
});
