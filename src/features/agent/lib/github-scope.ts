import type { AgentContext, AgentContextRepo } from "../types";

function isPlaceholder(value?: string): boolean {
  const normalized = (value || "").trim().toLowerCase();
  return !normalized || normalized === "pending" || normalized === "unknown";
}

export function isLinkedGithubRepo(repo: AgentContextRepo): boolean {
  const url = (repo.githubUrl || "").trim().toLowerCase();
  if (url && url !== "pending") return true;
  return !isPlaceholder(repo.owner) && !isPlaceholder(repo.repositoryName);
}

export function linkedGithubRepos(context: AgentContext): AgentContextRepo[] {
  return context.githubRepos.filter(isLinkedGithubRepo);
}

export function projectGithubRepos(context: AgentContext, projectId?: string): AgentContextRepo[] {
  if (!projectId) return [];
  return linkedGithubRepos(context).filter((repo) => repo.projectId === projectId);
}

export function hasProjectGithubRepo(context: AgentContext, projectId?: string): boolean {
  return projectGithubRepos(context, projectId).length > 0;
}

export function hasGithubAccount(context: AgentContext): boolean {
  return Boolean(context.githubAccount?.connected);
}

/** True when Fairlx can call GitHub as this user (OAuth/PAT with repo access). */
export function hasGithubRepoAccess(context: AgentContext): boolean {
  const account = context.githubAccount;
  if (!account) return false;
  if (typeof account.hasRepoAccess === "boolean") return account.hasRepoAccess;
  return Boolean(account.connected);
}

export function canAttachProjectGithub(context: AgentContext, projectId?: string): boolean {
  if (!projectId) return false;
  return (context.githubAttachProjectIds ?? []).includes(projectId);
}

export function formatProjectGithubLine(context: AgentContext, projectId?: string): string {
  const repos = projectGithubRepos(context, projectId);
  const login = context.githubAccount?.login ? `@${context.githubAccount.login}` : "this Fairlx user";
  const canAttach = canAttachProjectGithub(context, projectId);

  if (repos.length && hasGithubAccount(context)) {
    const labels = repos
      .slice(0, 3)
      .map((repo) =>
        repo.owner && repo.repositoryName ? `${repo.owner}/${repo.repositoryName}` : repo.repositoryName || "repo",
      );
    return `GitHub: ${labels.join(", ")} is attached to this project (identity only). Code actions run as ${login}'s GitHub account and GitHub permissions. Never call request_capability for GitHub and never say an action is unavailable — use github_list_files, github_read_file, github_write_file, github_update_repo, github_open_pr, github_merge_pr, github_create_issue, github_list_issues, github_list_prs, coding_session_start, and security_review.`;
  }
  if (repos.length && !hasGithubAccount(context)) {
    const labels = repos
      .slice(0, 3)
      .map((repo) =>
        repo.owner && repo.repositoryName ? `${repo.owner}/${repo.repositoryName}` : repo.repositoryName || "repo",
      );
    return `GitHub: ${labels.join(", ")} is attached to this project, but this user has not connected their GitHub account. Call request_capability with code.write so they can Sign in with GitHub. Do not use a project token.`;
  }
  if (hasGithubAccount(context)) {
    if (canAttach) {
      return `GitHub: account connected as ${login} (Fairlx profile). No repository attached to this Fairlx project. If they asked to connect, link, or attach an existing GitHub.com repo, call github_link_repo with owner and repo (or repoId owner/repo) — do not github_create_repo and do not request_capability. Call github_list_repos (pass query if they named a product) to search THIS USER's GitHub account. fairlx_github_repo_list and empty git_status.projectRepositories only mean nothing is attached in Fairlx — not that GitHub is disconnected. After you have owner/repo, github_list_files with repoId owner/repo. If they asked to create a new repo, call github_list_owners then github_create_repo with owner, name, autoInit true, private true, and linkToProject true. If they replied with an owner login after needsOwnerChoice, call github_create_repo with that owner — do not say tools are unavailable. After create, github_write_file README.md if they asked for a README. To change visibility, github_update_repo with private true or false. Do not call request_capability while the account is connected.`;
    }
    return `GitHub: account connected as ${login} (Fairlx profile). No repository attached to this Fairlx project. Call github_list_repos to search THIS USER's GitHub account. This user cannot attach a repo (needs workspace admin, project admin, or project settings access) — github_link_repo will fail. They can still inspect GitHub.com repos with github_list_files repoId owner/repo, or create with github_create_repo (linkToProject false). Tell them to ask a lead to attach it in Integrations. Do not call request_capability.`;
  }
  return "GitHub: none attached for this project, and no GitHub account is connected to this user's Fairlx profile. Skip github_list_files and github_read_file. If the user asked to create a GitHub repository, call request_capability with code.write so they can Sign in with GitHub or paste a PAT. Do not stall planning or documentation.";
}
