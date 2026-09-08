import { describe, expect, it } from "vitest";

import { typingGazeProgress } from "./typing-gaze";

describe("typingGazeProgress", () => {
  it("looks toward the start of an empty line", () => {
    expect(typingGazeProgress({ value: "", widthPx: 400, fontSizePx: 16 })).toBeCloseTo(0.12);
  });

  it("looks right as the current line grows", () => {
    const left = typingGazeProgress({ value: "Hi", widthPx: 400, fontSizePx: 16 });
    const right = typingGazeProgress({
      value: "Hello there, this is a much longer line of typing",
      widthPx: 400,
      fontSizePx: 16,
    });
    expect(right).toBeGreaterThan(left);
  });

  it("uses the caret line, not later text", () => {
    const progress = typingGazeProgress({
      value: "short\nthis is a very long second line",
      caret: 3,
      widthPx: 400,
      fontSizePx: 16,
    });
    expect(progress).toBeLessThan(0.4);
  });
});
