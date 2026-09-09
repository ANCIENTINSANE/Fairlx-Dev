import { describe, expect, it, vi } from "vitest";

import { consumeSelfTrainChunk, parseSelfTrainLine } from "./self-train-stream";

describe("self-train stream parser", () => {
  it("parses SSE data lines and NDJSON", () => {
    expect(parseSelfTrainLine('data: {"percent":18,"stage":"Reading your workspace"}')).toEqual({
      percent: 18,
      stage: "Reading your workspace",
    });
    expect(parseSelfTrainLine('{"percent":100,"done":true}')).toEqual({ percent: 100, done: true });
    expect(parseSelfTrainLine("")).toBeNull();
    expect(parseSelfTrainLine("not-json")).toBeNull();
  });

  it("emits complete events as chunks arrive and keeps a partial line", () => {
    const events: Array<{ percent: number }> = [];
    const rest = consumeSelfTrainChunk("", 'data: {"percent":4,"stage":"Reading"}\n\ndata: {"percent":12', (event) => {
      events.push(event);
    });
    expect(events).toEqual([{ percent: 4, stage: "Reading" }]);
    expect(rest).toBe('data: {"percent":12');

    const onSecond = vi.fn();
    expect(consumeSelfTrainChunk(rest, ',"stage":"Reading"}\n', onSecond)).toBe("");
    expect(onSecond).toHaveBeenCalledWith({ percent: 12, stage: "Reading" });
  });
});
