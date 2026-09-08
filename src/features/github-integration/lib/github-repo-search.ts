export type GithubAccountRepo = {
  name: string;
  fullName: string;
  url: string;
  private: boolean;
  defaultBranch: string;
  description?: string | null;
  source: "github_account";
};

export function matchesGithubRepoQuery(
  repo: { name?: string; full_name?: string; fullName?: string; description?: string | null },
  query?: string,
): boolean {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  const hay = `${repo.name || ""} ${repo.full_name || repo.fullName || ""} ${repo.description || ""}`.toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((part) => hay.includes(part));
}

export function toGithubAccountRepo(repo: {
  name: string;
  full_name: string;
  html_url: string;
  private?: boolean;
  default_branch?: string;
  description?: string | null;
}): GithubAccountRepo {
  return {
    name: repo.name,
    fullName: repo.full_name,
    url: repo.html_url,
    private: Boolean(repo.private),
    defaultBranch: repo.default_branch || "main",
    description: repo.description ?? null,
    source: "github_account",
  };
}
