import { describe, expect, it } from "vitest";

import { isCodingFaceActivity, isReadingFaceActivity, isSearchingFaceActivity, resolveAgentFaceMood } from "./agent-face-mood";
import type { AgentToolEvent } from "../types";

function event(type: AgentToolEvent["type"], title: string = type, extra?: Partial<AgentToolEvent>): AgentToolEvent {
  return {
    id: `${type}-1`,
    type,
    title,
    createdAt: extra?.createdAt || new Date().toISOString(),
    runId: "r1",
    ...extra,
  };
}

describe("resolveAgentFaceMood", () => {
  it("looks down while the user is typing and the run is idle", () => {
    expect(resolveAgentFaceMood({ typing: true })).toBe("lookDown");
    expect(resolveAgentFaceMood({ status: "idle", typing: true })).toBe("lookDown");
  });

  it("thinks while the run is working, and codes when code tools fire", () => {
    expect(resolveAgentFaceMood({ status: "running" })).toBe("thinking");
    expect(resolveAgentFaceMood({ status: "running", events: [event("thought")] })).toBe("thinking");
    expect(resolveAgentFaceMood({ status: "running", events: [event("git_stage")] })).toBe("coding");
    expect(resolveAgentFaceMood({ status: "running", kind: "coding_session" })).toBe("coding");
    expect(
      resolveAgentFaceMood({
        status: "running",
        events: [event("delegate_agent", "Delegated to builder")],
      }),
    ).toBe("coding");
  });

  it("searches and reads from the latest working event", () => {
    expect(resolveAgentFaceMood({ status: "running", events: [event("web_search")] })).toBe("searching");
    expect(resolveAgentFaceMood({ status: "running", events: [event("personal_read")] })).toBe("reading");
    expect(
      resolveAgentFaceMood({
        status: "running",
        events: [event("web_search"), event("github_read_file")],
      }),
    ).toBe("reading");
    expect(
      resolveAgentFaceMood({
        status: "running",
        events: [event("web_search"), event("git_stage")],
      }),
    ).toBe("coding");
  });

  it("smiles only while celebrating a finished turn", () => {
    expect(resolveAgentFaceMood({ status: "completed" })).toBe("idle");
    expect(resolveAgentFaceMood({ status: "completed", celebrating: true })).toBe("happy");
    expect(resolveAgentFaceMood({ status: "completed", celebrating: true, typing: true })).toBe("lookDown");
  });

  it("asks when waiting, and shows error when the run failed", () => {
    expect(resolveAgentFaceMood({ status: "awaiting_question" })).toBe("ask");
    expect(resolveAgentFaceMood({ awaitingYou: true })).toBe("ask");
    expect(resolveAgentFaceMood({ status: "failed" })).toBe("error");
  });

  it("detects coding, search, and reading activity from recent events", () => {
    expect(isCodingFaceActivity([event("web_search")])).toBe(false);
    expect(isCodingFaceActivity([event("coding_session_exec")])).toBe(true);
    expect(isSearchingFaceActivity([event("web_search")])).toBe(true);
    expect(isSearchingFaceActivity([event("thought")])).toBe(false);
    expect(isReadingFaceActivity([event("personal_read")])).toBe(true);
    expect(isReadingFaceActivity([event("web_search")])).toBe(false);
  });
});
