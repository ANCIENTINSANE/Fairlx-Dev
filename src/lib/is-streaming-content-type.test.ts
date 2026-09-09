import { describe, expect, it } from "vitest";

import { isStreamingContentType } from "./is-streaming-content-type";

describe("isStreamingContentType", () => {
  it("treats SSE, NDJSON, and octet-stream as streaming", () => {
    expect(isStreamingContentType("text/event-stream; charset=utf-8")).toBe(true);
    expect(isStreamingContentType("application/x-ndjson; charset=utf-8")).toBe(true);
    expect(isStreamingContentType("application/ndjson")).toBe(true);
    expect(isStreamingContentType("application/octet-stream")).toBe(true);
    expect(isStreamingContentType("text/plain")).toBe(true);
  });

  it("does not treat JSON as streaming", () => {
    expect(isStreamingContentType("application/json")).toBe(false);
    expect(isStreamingContentType("")).toBe(false);
    expect(isStreamingContentType(undefined)).toBe(false);
  });
});
