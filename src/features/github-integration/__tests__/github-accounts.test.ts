import { describe, expect, it } from "vitest";

import { isPendingGithubRepo } from "../lib/github-accounts";

describe("isPendingGithubRepo", () => {
  it("treats authenticating and pending placeholders as incomplete", () => {
    expect(isPendingGithubRepo({ status: "authenticating", owner: "acme", repositoryName: "app" })).toBe(true);
    expect(isPendingGithubRepo({ githubUrl: "pending", owner: "pending", repositoryName: "pending" })).toBe(true);
    expect(isPendingGithubRepo({ githubUrl: "pending", owner: "", repositoryName: "" })).toBe(true);
    expect(isPendingGithubRepo({ githubUrl: "https://github.com/acme/app", owner: "acme", repositoryName: "app" })).toBe(
      false,
    );
  });
});
