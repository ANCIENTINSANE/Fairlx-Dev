import { describe, expect, it } from "vitest";

import { matchesGithubRepoQuery, toGithubAccountRepo } from "../lib/github-repo-search";

describe("matchesGithubRepoQuery", () => {
  it("matches Fairlx-Dev when the user asked for Fairlx", () => {
    expect(
      matchesGithubRepoQuery(
        { name: "Fairlx-Dev", full_name: "ANCIENTINSANE/Fairlx-Dev", description: "Work OS" },
        "Fairlx",
      ),
    ).toBe(true);
  });

  it("does not treat an empty Fairlx project link list as a miss on unrelated names", () => {
    expect(
      matchesGithubRepoQuery({ name: "notes", full_name: "ada/notes", description: "" }, "fairlx codebase"),
    ).toBe(false);
  });
});

describe("toGithubAccountRepo", () => {
  it("marks GitHub API rows as account repos, not Fairlx project links", () => {
    expect(
      toGithubAccountRepo({
        name: "Fairlx-Dev",
        full_name: "ANCIENTINSANE/Fairlx-Dev",
        html_url: "https://github.com/ANCIENTINSANE/Fairlx-Dev",
        private: true,
        default_branch: "main",
      }),
    ).toMatchObject({
      fullName: "ANCIENTINSANE/Fairlx-Dev",
      source: "github_account",
    });
  });
});
