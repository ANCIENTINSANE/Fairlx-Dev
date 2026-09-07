import { ID, Query, type Databases } from "node-appwrite";

import { DATABASE_ID, GITHUB_REPOS_ID, PROJECTS_ID } from "@/config";

import type { GitHubRepository } from "../types";
import { isPendingGithubRepo } from "./github-accounts";
import { GitHubAPI } from "./github-api";
import { GITHUB_ATTACH_FORBIDDEN, userCanManageProjectGithub } from "./github-permissions";

export async function linkGithubRepoToProject(params: {
  databases: Databases;
  userId: string;
  projectId: string;
  owner: string;
  repo: string;
  branch?: string;
  token?: string;
  requireAdmin?: boolean;
}): Promise<GitHubRepository> {
  const { databases, userId, projectId, owner, repo } = params;
  const branch = params.branch || "main";
  const project = await databases.getDocument(DATABASE_ID, PROJECTS_ID, projectId);
  if (!project) throw new Error("Project not found");

  if (params.requireAdmin !== false) {
    const allowed = await userCanManageProjectGithub(databases, userId, projectId);
    if (!allowed) throw new Error(GITHUB_ATTACH_FORBIDDEN);
  }

  const existing = await databases.listDocuments<GitHubRepository>(DATABASE_ID, GITHUB_REPOS_ID, [
    Query.equal("projectId", projectId),
    Query.limit(100),
  ]);

  const githubUrl = `https://github.com/${owner}/${repo}`.toLowerCase();
  const payload = {
    githubUrl,
    repositoryName: repo,
    owner,
    branch,
    accessToken: "",
    status: "connected" as const,
    lastSyncedAt: new Date().toISOString(),
    lastModifiedBy: userId,
    error: null as string | null,
  };

  const keeper =
    existing.documents.find((doc) => !isPendingGithubRepo(doc)) ?? existing.documents[0];

  for (const doc of existing.documents) {
    if (keeper && doc.$id !== keeper.$id) {
      await databases.deleteDocument(DATABASE_ID, GITHUB_REPOS_ID, doc.$id);
    }
  }

  if (keeper) {
    return databases.updateDocument<GitHubRepository>(DATABASE_ID, GITHUB_REPOS_ID, keeper.$id, payload);
  }

  return databases.createDocument<GitHubRepository>(DATABASE_ID, GITHUB_REPOS_ID, ID.unique(), {
    projectId,
    workspaceId: String(project.workspaceId),
    ...payload,
    createdBy: userId,
    autoFetchCommits: true,
    linkCommitsToTasks: true,
    syncComments: true,
    allowPrMerge: true,
    createTasksFromIssues: true,
  });
}

export async function createGithubRepository(params: {
  token: string;
  name: string;
  owner?: string;
  description?: string;
  private?: boolean;
  autoInit?: boolean;
}): Promise<{
  owner: string;
  repo: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
  fullName: string;
}> {
  const api = new GitHubAPI(params.token);
  const created = await api.createRepository({
    name: params.name,
    owner: params.owner,
    description: params.description,
    private: params.private,
    autoInit: params.autoInit !== false,
  });
  return {
    owner: created.owner.login,
    repo: created.name,
    htmlUrl: created.html_url,
    defaultBranch: created.default_branch || "main",
    private: Boolean(created.private),
    fullName: created.full_name,
  };
}
