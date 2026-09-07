import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  shouldForceNeedsYou,
  signStandinToken,
  standinCommentBody,
  stripStandinMentions,
  verifyStandinToken,
} from "./personal-standin";

describe("personal stand-in safety", () => {
  it("strips mentions so the agent cannot expand the thread", () => {
    const cleaned = stripStandinMentions("Hey @Ada[u1] and @Sam, looks good");
    expect(cleaned).not.toMatch(/@/);
    expect(cleaned).toContain("looks good");
  });

  it("labels the posted comment instead of impersonating", () => {
    const body = standinCommentBody("Ada", "I'll check WEB-12 after standup.");
    expect(body).toContain("Personal Agent for Ada");
    expect(body).toContain("I'll check WEB-12 after standup.");
  });

  it("forces human review for estimates and never-do overlap", () => {
    expect(shouldForceNeedsYou("I estimate two days.")).toBe(true);
    expect(
      shouldForceNeedsYou("Ship it to production tonight.", [
        { questionId: "never_do", question: "never", answer: "Never merge to production without me." },
      ]),
    ).toBe(true);
    expect(shouldForceNeedsYou("It's in review on WEB-12.")).toBe(false);
  });

  it("signs and verifies approval tokens", () => {
    const token = signStandinToken("job1", "approve");
    expect(verifyStandinToken("job1", "approve", token)).toBe(true);
    expect(verifyStandinToken("job1", "self", token)).toBe(false);
    expect(verifyStandinToken("job2", "approve", token)).toBe(false);
  });
});
