import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Databases } from "node-appwrite";

vi.mock("server-only", () => ({}));

vi.mock("@/features/github-integration/lib/github-accounts", () => ({
  isPendingGithubRepo: () => false,
  listGithubOwners: vi.fn(),
  resolveUserGithubToken: vi.fn(),
}));

vi.mock("@/features/github-integration/lib/github-link", () => ({
  createGithubRepository: vi.fn(),
  linkGithubRepoToProject: vi.fn(),
}));

vi.mock("@/features/github-integration/lib/github-api", () => ({
  GitHubAPI: class {
    async getRepository() {
      return { default_branch: "main", full_name: "ANCIENTINSANE/Fairlx-Dev" };
    }
  },
}));

import { resolveUserGithubToken } from "@/features/github-integration/lib/github-accounts";
import { linkGithubRepoToProject } from "@/features/github-integration/lib/github-link";
import { GITHUB_ATTACH_FORBIDDEN } from "@/features/github-integration/lib/github-permissions";

import { githubLinkRepo } from "./github";

const databases = {} as Databases;
const resolveToken = vi.mocked(resolveUserGithubToken);
const linkRepo = vi.mocked(linkGithubRepoToProject);

describe("githubLinkRepo", () => {
  beforeEach(() => {
    resolveToken.mockReset();
    linkRepo.mockReset();
    resolveToken.mockResolvedValue({ token: "ghp_test", source: "account", githubLogin: "ANCIENTINSANE" });
    linkRepo.mockResolvedValue({
      $id: "link1",
      owner: "ANCIENTINSANE",
      repositoryName: "Fairlx-Dev",
      githubUrl: "https://github.com/ancientinsane/fairlx-dev",
      branch: "main",
    } as Awaited<ReturnType<typeof linkGithubRepoToProject>>);
  });

  it("attaches an existing owner/repo without asking to reconnect GitHub", async () => {
    const result = await githubLinkRepo({
      databases,
      userId: "u1",
      projectId: "p1",
      owner: "ANCIENTINSANE",
      repo: "Fairlx-Dev",
    });
    expect(result).toMatchObject({
      linked: true,
      fullName: "ANCIENTINSANE/Fairlx-Dev",
    });
    expect("capability" in result).toBe(false);
    expect("error" in result).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/Sign in with GitHub/i);
    expect(linkRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "ANCIENTINSANE",
        repo: "Fairlx-Dev",
        projectId: "p1",
      }),
    );
  });

  it("accepts repoId as owner/repo", async () => {
    const result = await githubLinkRepo({
      databases,
      userId: "u1",
      projectId: "p1",
      repoId: "ANCIENTINSANE/Fairlx-Dev",
    });
    expect("fullName" in result && result.fullName).toBe("ANCIENTINSANE/Fairlx-Dev");
  });

  it("does not treat attach-forbidden as a GitHub OAuth gap", async () => {
    linkRepo.mockRejectedValueOnce(new Error(GITHUB_ATTACH_FORBIDDEN));
    const result = await githubLinkRepo({
      databases,
      userId: "u1",
      projectId: "p1",
      owner: "ANCIENTINSANE",
      repo: "Fairlx-Dev",
    });
    expect(result).toMatchObject({ error: GITHUB_ATTACH_FORBIDDEN, skipped: true });
    expect("capability" in result).toBe(false);
  });

  it("attaches without a GitHub API token when owner and repo are already known", async () => {
    resolveToken.mockResolvedValueOnce(null);
    const result = await githubLinkRepo({
      databases,
      userId: "u1",
      projectId: "p1",
      owner: "ANCIENTINSANE",
      repo: "Fairlx-Dev",
    });
    expect(result).toMatchObject({ linked: true, fullName: "ANCIENTINSANE/Fairlx-Dev" });
  });
});
