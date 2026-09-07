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
    return `GitHub: ${labels.join(", ")} is attached to this project (identity only). Code actions run as ${login}'s GitHub account and GitHub permissions. Never call request_capability for GitHub — use github_list_files, github_read_file, github_write_file, github_open_pr, github_merge_pr, coding_session_start, and security_review.`;
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
      return `GitHub: account connected as ${login} (Fairlx profile). No repository attached to this project. If the user asked to create a repo, call github_list_owners. If more than one owner (personal + organizations) is returned, ask which one, then call github_create_repo with owner, name, autoInit true, and linkToProject true. Do not call request_capability while the account is connected.`;
    }
    return `GitHub: account connected as ${login} (Fairlx profile). No repository attached to this project. This user cannot attach a repo (needs workspace admin, project admin, or project settings access). They can still create a GitHub repo with github_create_repo (linkToProject false). Tell them to ask a lead to attach it in Integrations. Do not call request_capability.`;
  }
  return "GitHub: none attached for this project, and no GitHub account is connected to this user's Fairlx profile. Skip github_list_files and github_read_file. If the user asked to create a GitHub repository, call request_capability with code.write so they can Sign in with GitHub or paste a PAT. Do not stall planning or documentation.";
}
