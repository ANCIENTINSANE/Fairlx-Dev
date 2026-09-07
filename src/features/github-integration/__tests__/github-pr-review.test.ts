import { describe, expect, it } from "vitest";

import { GitHubAPI } from "../lib/github-api";

describe("GitHub PR review API surface", () => {
  it("exposes merge, review, checks, and compare helpers", () => {
    const api = new GitHubAPI("test-token");
    expect(api.getAccessToken()).toBe("test-token");
    expect(typeof api.compareCommits).toBe("function");
    expect(typeof api.listPullRequestFiles).toBe("function");
    expect(typeof api.createReview).toBe("function");
    expect(typeof api.createReviewComment).toBe("function");
    expect(typeof api.listCheckRuns).toBe("function");
    expect(typeof api.mergePullRequest).toBe("function");
    expect(typeof api.requestReviewers).toBe("function");
  });
});
