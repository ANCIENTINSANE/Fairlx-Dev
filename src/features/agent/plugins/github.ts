import { Query, type Databases } from "node-appwrite";

import { DATABASE_ID, GITHUB_REPOS_ID } from "@/config";
import { GitHubAPI } from "@/features/github-integration/lib/github-api";
import {
  isPendingGithubRepo,
  listGithubOwners,
  resolveUserGithubToken,
} from "@/features/github-integration/lib/github-accounts";
import { createGithubRepository, linkGithubRepoToProject } from "@/features/github-integration/lib/github-link";

import type { AgentCapability, AgentContext, AgentContextRepo, AgentPluginConnection } from "../types";
import { decryptSecret } from "../lib/secrets";

import { normalizeGitHubPath, parseGithubRepoRef } from "./github-helpers";

export { githubCapabilityGap, normalizeGitHubPath, parseGithubRepoRef, parsePrFiles } from "./github-helpers";

export type GithubRepoOk = {
  api: GitHubAPI;
  owner: string;
  repo: string;
  branch: string;
  repoId?: string;
};

export type GithubRepoErr = { error: string; capability?: AgentCapability; skipped?: boolean };

export const NO_LINKED_GITHUB_REPO =
  "No GitHub repository is attached to this Fairlx project. Skip code analysis and continue from Fairlx work items. Do not create technical_spec or api_doc until a lead attaches a repo. Planning docs (prd, frd, user_stories, user_guide, test_plan) are fine.";

export const CONNECT_PERSONAL_GITHUB =
  "Connect your GitHub account to your Fairlx profile. Sign in with GitHub or paste a PAT with repo and read:org. Code actions (read, write, PRs, merge) run as your GitHub user.";

export async function resolveGithubRepo(params: {
  databases?: Databases;
  context: AgentContext;
  plugins: AgentPluginConnection[];
  repoId?: string;
  projectId?: string;
  owner?: string;
  repo?: string;
  branch?: string;
}): Promise<GithubRepoOk | GithubRepoErr> {
  const override = params.plugins.find(
    (plugin) => plugin.catalogId === "github" && plugin.status === "connected" && plugin.secrets?.accessTokenEncrypted,
  );
  const overrideToken = override?.secrets?.accessTokenEncrypted
    ? decryptSecret(override.secrets.accessTokenEncrypted)
    : "";
  const extraOwner = override?.secrets?.extra?.owner;
  const extraRepo = override?.secrets?.extra?.repo;
  const repoRef = parseGithubRepoRef(params.repoId) ?? parseGithubRepoRef(
    params.owner && params.repo ? `${params.owner}/${params.repo}` : undefined,
  );

  const usable = (item: AgentContextRepo) => {
    const url = (item.githubUrl || "").trim().toLowerCase();
    const owner = (item.owner || "").trim().toLowerCase();
    const name = (item.repositoryName || "").trim().toLowerCase();
    if (url && url !== "pending") return true;
    return Boolean(owner && name && owner !== "pending" && name !== "pending");
  };
  let match: AgentContextRepo | undefined = params.context.githubRepos.find((item) => {
    if (!usable(item)) return false;
    if (params.repoId && item.id === params.repoId) return true;
    if (repoRef && item.owner === repoRef.owner && item.repositoryName === repoRef.repo) return true;
    if (params.owner && params.repo) {
      return item.owner === params.owner && item.repositoryName === params.repo;
    }
    return false;
  });
  if (!match && params.projectId) {
    match = params.context.githubRepos.find((item) => usable(item) && item.projectId === params.projectId);
  }
  if (!match && params.databases && params.projectId) {
    try {
      const listed = await params.databases.listDocuments(DATABASE_ID, GITHUB_REPOS_ID, [
        Query.equal("projectId", params.projectId),
        Query.limit(5),
      ]);
      const doc = listed.documents.find((item) => !isPendingGithubRepo({
        githubUrl: String(item.githubUrl ?? ""),
        owner: String(item.owner ?? ""),
        repositoryName: String(item.repositoryName ?? item.name ?? ""),
        status: String(item.status ?? ""),
      }));
      if (doc) {
        match = {
          id: doc.$id,
          owner: String(doc.owner ?? ""),
          repositoryName: String(doc.repositoryName ?? doc.name ?? ""),
          githubUrl: String(doc.githubUrl ?? ""),
          workspaceId: String(doc.workspaceId ?? ""),
          projectId: String(doc.projectId ?? params.projectId),
          branch: String(doc.branch ?? "main"),
        };
      }
    } catch {
      // Fall through to context repos.
    }
  }
  if (!match) {
    match =
      params.context.githubRepos.find((item) => usable(item) && (!params.projectId || item.projectId === params.projectId)) ??
      (!params.projectId ? params.context.githubRepos.find(usable) : undefined);
  }

  const owner = params.owner || match?.owner || extraOwner || repoRef?.owner || "";
  const repo = params.repo || match?.repositoryName || extraRepo || repoRef?.repo || "";
  const branch = params.branch || match?.branch || "main";
  if (!owner || !repo) {
    return {
      error: NO_LINKED_GITHUB_REPO,
      skipped: true,
    };
  }

  let token = overrideToken;
  const userId = params.context.user.id;
  if (!token && params.databases && userId) {
    const resolved = await resolveUserGithubToken(params.databases, userId);
    token = resolved?.token || "";
  }

  if (!token) {
    return {
      error: CONNECT_PERSONAL_GITHUB,
      capability: "code.write",
    };
  }

  return {
    api: new GitHubAPI(token),
    owner,
    repo,
    branch,
    repoId: match?.id,
  };
}

export async function githubListFiles(params: {
  databases?: Databases;
  context: AgentContext;
  plugins: AgentPluginConnection[];
  path?: string;
  repoId?: string;
  projectId?: string;
  branch?: string;
}) {
  const resolved = await resolveGithubRepo({ ...params, branch: params.branch });
  if ("error" in resolved) return resolved;
  const path = normalizeGitHubPath(params.path || "");
  try {
    const entries = await resolved.api.getContents(resolved.owner, resolved.repo, path, params.branch || resolved.branch);
    return {
      owner: resolved.owner,
      repo: resolved.repo,
      branch: params.branch || resolved.branch,
      path: path || "/",
      items: entries.map((item) => ({ name: item.name, path: item.path, type: item.type, size: item.size })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list files";
    return {
      error: message,
      path: path || "/",
      missing: /not found/i.test(message),
      hint: "Omit path to list the repo root, or list a parent folder that github_list_files already returned.",
    };
  }
}

export async function githubReadFile(params: {
  databases?: Databases;
  context: AgentContext;
  plugins: AgentPluginConnection[];
  path: string;
  repoId?: string;
  projectId?: string;
  branch?: string;
}) {
  const resolved = await resolveGithubRepo({ ...params, branch: params.branch });
  if ("error" in resolved) return resolved;
  const path = normalizeGitHubPath(params.path);
  if (!path) {
    return { error: "path is required", skipped: true };
  }
  const branch = params.branch || resolved.branch;
  try {
    const content = await resolved.api.getFileContent(resolved.owner, resolved.repo, path, branch);
    return {
      owner: resolved.owner,
      repo: resolved.repo,
      branch,
      path,
      content: content.slice(0, 20000),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read file";
    if (/invalid file type/i.test(message)) {
      try {
        const entries = await resolved.api.getContents(resolved.owner, resolved.repo, path, branch);
        return {
          error: `${path} is a directory. Call github_list_files on this path, then github_read_file on a file from that listing.`,
          path,
          items: entries.map((item) => ({ name: item.name, path: item.path, type: item.type, size: item.size })),
        };
      } catch {
        // Fall through to the missing-path payload.
      }
    }
    return {
      error: message,
      path,
      missing: /not found/i.test(message),
      hint: "List the parent folder with github_list_files and only read paths from that listing. Missing files must not stop the audit.",
    };
  }
}

export async function githubWriteFile(params: {
  databases?: Databases;
  context: AgentContext;
  plugins: AgentPluginConnection[];
  path: string;
  content: string;
  message: string;
  branch?: string;
  repoId?: string;
  projectId?: string;
}) {
  const resolved = await resolveGithubRepo(params);
  if ("error" in resolved) {
    return resolved;
  }
  const branch = params.branch || `fairlx/${Date.now().toString(36)}`;
  const result = await resolved.api.putFile({
    owner: resolved.owner,
    repo: resolved.repo,
    path: params.path,
    content: params.content,
    message: params.message || `Update ${params.path}`,
    branch,
    baseBranch: resolved.branch,
  });
  return {
    owner: resolved.owner,
    repo: resolved.repo,
    branch,
    path: params.path,
    sha: result.sha,
    html_url: result.html_url,
  };
}

export async function githubOpenPullRequest(params: {
  databases?: Databases;
  context: AgentContext;
  plugins: AgentPluginConnection[];
  title: string;
  body?: string;
  head: string;
  base?: string;
  repoId?: string;
  projectId?: string;
}) {
  const resolved = await resolveGithubRepo(params);
  if ("error" in resolved) {
    return resolved;
  }
  const pr = await resolved.api.createPullRequest({
    owner: resolved.owner,
    repo: resolved.repo,
    title: params.title,
    body: params.body || "",
    head: params.head,
    base: params.base || resolved.branch,
  });
  return {
    owner: resolved.owner,
    repo: resolved.repo,
    number: pr.number,
    html_url: pr.html_url,
    title: pr.title,
  };
}

export async function githubCommitFilesAndOpenPr(params: {
  databases?: Databases;
  context: AgentContext;
  plugins: AgentPluginConnection[];
  title: string;
  body?: string;
  files: Array<{ path: string; content: string; message?: string }>;
  branch?: string;
  base?: string;
  repoId?: string;
  projectId?: string;
  onProgress?: (step: string, percent: number) => Promise<void> | void;
}) {
  const resolved = await resolveGithubRepo(params);
  if ("error" in resolved) {
    return resolved;
  }
  const branch = params.branch || `fairlx/${Date.now().toString(36)}`;
  const written: Array<{ path: string; sha: string; html_url?: string }> = [];
  for (let index = 0; index < params.files.length; index += 1) {
    const file = params.files[index]!;
    await params.onProgress?.(`Writing ${file.path}`, Math.round(((index + 1) / Math.max(params.files.length + 1, 1)) * 90));
    const result = await resolved.api.putFile({
      owner: resolved.owner,
      repo: resolved.repo,
      path: file.path,
      content: file.content,
      message: file.message || params.title || `Update ${file.path}`,
      branch,
      baseBranch: params.base || resolved.branch,
    });
    written.push({ path: file.path, sha: result.sha, html_url: result.html_url });
  }
  await params.onProgress?.("Opening pull request", 95);
  const pr = await resolved.api.createPullRequest({
    owner: resolved.owner,
    repo: resolved.repo,
    title: params.title,
    body: params.body || "",
    head: branch,
    base: params.base || resolved.branch,
  });
  return {
    owner: resolved.owner,
    repo: resolved.repo,
    branch,
    number: pr.number,
    html_url: pr.html_url,
    title: pr.title,
    files: written,
  };
}

export async function githubMergePullRequest(params: {
  databases?: Databases;
  context: AgentContext;
  plugins: AgentPluginConnection[];
  pullNumber: number;
  repoId?: string;
  projectId?: string;
  commitTitle?: string;
  mergeMethod?: "merge" | "squash" | "rebase";
}) {
  const resolved = await resolveGithubRepo(params);
  if ("error" in resolved) {
    return resolved;
  }
  const result = await resolved.api.mergePullRequest({
    owner: resolved.owner,
    repo: resolved.repo,
    pullNumber: params.pullNumber,
    commitTitle: params.commitTitle,
    mergeMethod: params.mergeMethod,
  });
  return {
    owner: resolved.owner,
    repo: resolved.repo,
    number: params.pullNumber,
    merged: result.merged,
    sha: result.sha,
    message: result.message,
  };
}

export async function githubRequestReviewers(params: {
  databases?: Databases;
  context: AgentContext;
  plugins: AgentPluginConnection[];
  pullNumber: number;
  reviewers: string[];
  repoId?: string;
  projectId?: string;
}) {
  const resolved = await resolveGithubRepo(params);
  if ("error" in resolved) return resolved;
  const result = await resolved.api.requestReviewers({
    owner: resolved.owner,
    repo: resolved.repo,
    pullNumber: params.pullNumber,
    reviewers: params.reviewers,
  });
  return { owner: resolved.owner, repo: resolved.repo, number: params.pullNumber, ...result };
}

export async function githubSessionDiff(params: {
  databases?: Databases;
  context: AgentContext;
  plugins: AgentPluginConnection[];
  pullNumber?: number;
  base?: string;
  head?: string;
  repoId?: string;
  projectId?: string;
}) {
  const resolved = await resolveGithubRepo(params);
  if ("error" in resolved) return resolved;
  if (params.pullNumber) {
    const files = await resolved.api.listPullRequestFiles(resolved.owner, resolved.repo, params.pullNumber);
    const checks = await resolved.api
      .listCheckRuns(resolved.owner, resolved.repo, params.head || resolved.branch)
      .catch(() => []);
    return { owner: resolved.owner, repo: resolved.repo, pullNumber: params.pullNumber, files, checks };
  }
  const base = params.base || resolved.branch;
  const head = params.head;
  if (!head) return { error: "head branch or pullNumber is required" };
  const compare = await resolved.api.compareCommits(resolved.owner, resolved.repo, base, head);
  const checks = await resolved.api.listCheckRuns(resolved.owner, resolved.repo, head).catch(() => []);
  return { owner: resolved.owner, repo: resolved.repo, base, head, ...compare, checks };
}

const GITHUB_AUTH_REQUIRED = {
  error: "GitHub is not connected. Ask the user to Sign in with GitHub or paste a PAT with repo and read:org.",
  capability: "code.write" as AgentCapability,
  code: "github_auth_required" as const,
};

export async function githubAccountStatus(params: {
  databases?: Databases;
  context: AgentContext;
  userId: string;
  projectId?: string;
}) {
  const account = params.context.githubAccount;
  if (!params.databases) {
    return {
      connected: Boolean(account?.connected),
      githubLogin: account?.login,
      linkedRepo: Boolean(params.projectId && params.context.githubRepos.some((repo) => repo.projectId === params.projectId)),
    };
  }
  const resolved = await resolveUserGithubToken(params.databases, params.userId, params.projectId);
  if (!resolved) return { connected: false, ...GITHUB_AUTH_REQUIRED };
  const owners = await listGithubOwners(resolved.token).catch(() => ({ login: resolved.githubLogin || "", owners: [] }));
  return {
    connected: true,
    githubLogin: owners.login || resolved.githubLogin,
    owners: owners.owners,
    needsOwnerChoice: owners.owners.length > 1,
    projectId: params.projectId,
  };
}

export async function githubListAccountOwners(params: {
  databases?: Databases;
  userId: string;
  projectId?: string;
}) {
  if (!params.databases) return GITHUB_AUTH_REQUIRED;
  const resolved = await resolveUserGithubToken(params.databases, params.userId, params.projectId);
  if (!resolved) return GITHUB_AUTH_REQUIRED;
  const result = await listGithubOwners(resolved.token);
  return {
    githubLogin: result.login,
    owners: result.owners,
    needsOwnerChoice: result.owners.length > 1,
    instruction: result.owners.length > 1
      ? "Ask the user whether to create the repository under their personal account or one of these organizations, then call github_create_repo with owner set to that login."
      : `Create under the personal account ${result.login}.`,
  };
}

export async function githubCreateRepo(params: {
  databases?: Databases;
  userId: string;
  projectId?: string;
  name?: string;
  owner?: string;
  description?: string;
  private?: boolean;
  autoInit?: boolean;
  linkToProject?: boolean;
}) {
  const name = (params.name || "").trim();
  if (!name) return { error: "name is required" };
  if (!params.databases) return GITHUB_AUTH_REQUIRED;
  const resolved = await resolveUserGithubToken(params.databases, params.userId, params.projectId);
  if (!resolved) return GITHUB_AUTH_REQUIRED;

  const owners = await listGithubOwners(resolved.token);
  const requestedOwner = (params.owner || "").trim();
  if (!requestedOwner && owners.owners.length > 1) {
    return {
      error: "Choose a personal account or organization.",
      code: "github_owner_required",
      githubLogin: owners.login,
      owners: owners.owners,
      needsOwnerChoice: true,
      instruction: "Ask the user where to create the repository, then retry github_create_repo with owner set to that login.",
    };
  }
  if (requestedOwner && !owners.owners.some((item) => item.login.toLowerCase() === requestedOwner.toLowerCase())) {
    return {
      error: `You cannot create a repository under ${requestedOwner}.`,
      owners: owners.owners,
      needsOwnerChoice: true,
    };
  }

  const created = await createGithubRepository({
    token: resolved.token,
    name,
    owner: requestedOwner || owners.login,
    description: params.description,
    private: params.private,
    autoInit: params.autoInit !== false,
  });

  let linked = false;
  let linkError: string | undefined;
  if (params.linkToProject !== false && params.projectId) {
    try {
      await linkGithubRepoToProject({
        databases: params.databases,
        userId: params.userId,
        projectId: params.projectId,
        owner: created.owner,
        repo: created.repo,
        branch: created.defaultBranch,
      });
      linked = true;
    } catch (error) {
      linkError = error instanceof Error ? error.message : "Created on GitHub but could not link this project.";
    }
  }

  return {
    ...created,
    linked,
    linkError,
    instruction: linked
      ? `Repository ${created.fullName} is attached to this project. Code actions run as this user's GitHub account. Use github_write_file and github_open_pr on this repo.`
      : `Repository ${created.fullName} is on GitHub${linkError ? ` (${linkError})` : ""}. Ask a workspace admin or someone with project settings access to attach it in Integrations.`,
  };
}
