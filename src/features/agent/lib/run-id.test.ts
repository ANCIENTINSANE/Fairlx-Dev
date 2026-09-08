import { describe, expect, it } from "vitest";

import { isAgentRunId } from "./run-id";

describe("agent run ids", () => {
  it("accepts Appwrite-safe ids including UUIDs", () => {
    expect(isAgentRunId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
    expect(isAgentRunId("run_client_abc123")).toBe(true);
    expect(isAgentRunId("")).toBe(false);
    expect(isAgentRunId("-starts-with-hyphen")).toBe(false);
    expect(isAgentRunId("x".repeat(37))).toBe(false);
  });
});
