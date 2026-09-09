import { describe, expect, it } from "vitest";

import { codingSessionPollMs } from "./use-coding-session";

describe("coding session polling", () => {
  it("polls while a session is active or the agent run is live", () => {
    expect(codingSessionPollMs("running")).toBe(2500);
    expect(codingSessionPollMs("preparing")).toBe(2500);
    expect(codingSessionPollMs(undefined, true)).toBe(2500);
  });

  it("stops after the session and run are idle", () => {
    expect(codingSessionPollMs()).toBe(false);
    expect(codingSessionPollMs("merged")).toBe(false);
    expect(codingSessionPollMs("failed")).toBe(false);
    expect(codingSessionPollMs("stopped", false)).toBe(false);
  });
});
