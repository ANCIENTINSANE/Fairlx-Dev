import { describe, expect, it } from "vitest";

import { presentAgentFace } from "./present";

describe("presentAgentFace", () => {
  it("maps product moods onto the studio visor", () => {
    expect(presentAgentFace("lookDown")).toEqual({ emotion: "idle", gaze: "down" });
    expect(presentAgentFace("thinking")).toEqual({ emotion: "thinking", gaze: "neutral" });
    expect(presentAgentFace("coding")).toEqual({ emotion: "focused", gaze: "neutral" });
    expect(presentAgentFace("searching")).toEqual({ emotion: "searching", gaze: "neutral" });
    expect(presentAgentFace("reading")).toEqual({ emotion: "reading", gaze: "neutral" });
    expect(presentAgentFace("happy")).toEqual({ emotion: "happy", gaze: "up" });
    expect(presentAgentFace("ask")).toEqual({ emotion: "curious", gaze: "neutral" });
    expect(presentAgentFace("error")).toEqual({ emotion: "error", gaze: "neutral" });
    expect(presentAgentFace("listening")).toEqual({ emotion: "listening", gaze: "neutral" });
    expect(presentAgentFace("idle")).toEqual({ emotion: "idle", gaze: "neutral" });
  });
});
