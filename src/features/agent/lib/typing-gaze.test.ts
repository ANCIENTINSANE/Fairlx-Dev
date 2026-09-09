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

  it("maintains rightward gaze when typing text with spaces on the right side", () => {
    const userSample = "fyrudtudtd            jjvufouvfuvuv            gugouguquiguigiug";
    const progress = typingGazeProgress({
      value: userSample,
      widthPx: 600,
      fontSizePx: 16,
    });
    // In the user's test case, typing on the right side should look to the right side (> 0.6)
    // and definitely NOT snap back to the left side (< 0.2)
    expect(progress).toBeGreaterThan(0.6);
  });

  it("does not suddenly switch from right to left as spaces are added to reach the right side", () => {
    const base = "fyrudtudtd   jjvufouvfuvuv   gugouguquiguigiug";
    const p1 = typingGazeProgress({ value: base, widthPx: 700, fontSizePx: 16 });
    const p2 = typingGazeProgress({ value: base + "     ", widthPx: 700, fontSizePx: 16 });
    const p3 = typingGazeProgress({ value: base + "          ", widthPx: 700, fontSizePx: 16 });

    expect(p2).toBeGreaterThanOrEqual(p1);
    expect(p3).toBeGreaterThanOrEqual(p2);
    // None should collapse to near 0
    expect(p1).toBeGreaterThan(0.4);
    expect(p2).toBeGreaterThan(0.4);
    expect(p3).toBeGreaterThan(0.4);
  });

  it("adapts correctly across different screen widths", () => {
    const text = "fyrudtudtd   jjvufouvfuvuv   gugouguquiguigiug";
    const narrowScreen = typingGazeProgress({ value: text, widthPx: 450, fontSizePx: 16 });
    const wideScreen = typingGazeProgress({ value: text, widthPx: 900, fontSizePx: 16 });

    // On a narrower screen, the text reaches further to the right edge than on a wide screen
    expect(narrowScreen).toBeGreaterThan(wideScreen);
    // Neither snaps to left (0)
    expect(narrowScreen).toBeGreaterThan(0.5);
    expect(wideScreen).toBeGreaterThan(0.3);
  });
});
