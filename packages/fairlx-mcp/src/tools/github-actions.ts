import { invalidParams } from "../protocol/errors";
import type { McpToolResult } from "../protocol/types";
import type { AuthContext } from "../auth/context";
import { PERMISSIONS, type McpRuntime } from "../runtime/types";
import { toolResult } from "../runtime/output";
import { requireProjectAccess } from "../runtime/rbac";
import { optionalBoolean, optionalString, requireString } from "./helpers";

function requireGithub(runtime: McpRuntime) {
  if (!runtime.githubRequest) {
    throw invalidParams("GitHub is not configured on this MCP runtime.");
  }
  return runtime.githubRequest;
}

async function requireGithubProject(
  args: Record<string, unknown>,
  runtime: McpRuntime,
  auth: AuthContext,
) {
  const projectId = optionalString(args, "projectId") || auth.projectId;
  if (projectId) {
    await requireProjectAccess(runtime, auth, projectId, PERMISSIONS.VIEW_PROJECT, ["project:read"]);
  }
  return projectId;
}

async function resolveOwnerRepo(
  args: Record<string, unknown>,
  runtime: McpRuntime,
  projectId?: string,
): Promise<{ owner: string; repo: string }> {
  const repoId = optionalString(args, "repoId");
  if (repoId?.includes("/")) {
    const [owner, repo] = repoId.split("/").filter(Boolean);
    if (owner && repo) return { owner, repo };
  }
  const owner = optionalString(args, "owner");
  const repo = optionalString(args, "repo") || optionalString(args, "name");
  if (owner && repo) return { owner, repo };
  if (projectId) {
    const listed = await runtime.store.list<Record<string, unknown>>(runtime.collections.githubRepos, [
      { type: "equal", field: "projectId", value: projectId },
      { type: "limit", value: 5 },
    ]);
    const doc = listed.documents.find((item) => item.owner && (item.repositoryName || item.name));
    if (doc) {
      return {
        owner: String(doc.owner),
        repo: String(doc.repositoryName || doc.name),
      };
    }
  }
  throw invalidParams("owner and repo are required, or pass repoId as owner/repo, or attach a GitHub repo to this project.");
}

async function githubJson(
  runtime: McpRuntime,
  auth: AuthContext,
  method: string,
  path: string,
  body?: unknown,
) {
  const request = requireGithub(runtime);
  const result = await request({ userId: auth.actorUserId, method, path, body });
  if (!result.ok) {
    return toolResult(
      {
        error: result.error || `GitHub ${method} ${path} failed`,
        status: result.status,
        instruction: "Do not say this GitHub action is unavailable. Retry with a connected GitHub account that has repo permission.",
      },
      true,
    );
  }
  return toolResult(result.data ?? { ok: true });
}

export async function handleGithubActionTool(
  name: string,
  args: Record<string, unknown>,
  runtime: McpRuntime,
  auth: AuthContext,
): Promise<McpToolResult> {
  const projectId = await requireGithubProject(args, runtime, auth);

  switch (name) {
    case "fairlx_github_repo_create": {
      const repoName = requireString(args, "name");
      const owner = optionalString(args, "owner");
      const isPrivate = args.private !== false;
      const path = owner ? `/orgs/${owner}/repos` : "/user/repos";
      return githubJson(runtime, auth, "POST", path, {
        name: repoName,
        description: optionalString(args, "description"),
        private: isPrivate,
        auto_init: args.autoInit !== false,
      });
    }
    case "fairlx_github_repo_update": {
      const { owner, repo } = await resolveOwnerRepo(args, runtime, projectId);
      const body: Record<string, unknown> = {};
      if (typeof args.private === "boolean") body.private = args.private;
      if (args.visibility === "private") body.private = true;
      if (args.visibility === "public") body.private = false;
      if (args.description !== undefined) body.description = optionalString(args, "description") ?? "";
      if (args.homepage !== undefined) body.homepage = optionalString(args, "homepage") ?? "";
      return githubJson(runtime, auth, "PATCH", `/repos/${owner}/${repo}`, body);
    }
    case "fairlx_github_file_list": {
      const { owner, repo } = await resolveOwnerRepo(args, runtime, projectId);
      const path = optionalString(args, "path") || "";
      const ref = optionalString(args, "branch") || optionalString(args, "ref");
      const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      return githubJson(runtime, auth, "GET", `/repos/${owner}/${repo}/contents/${path}${qs}`);
    }
    case "fairlx_github_file_read": {
      const { owner, repo } = await resolveOwnerRepo(args, runtime, projectId);
      const path = requireString(args, "path");
      const ref = optionalString(args, "branch") || optionalString(args, "ref");
      const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      return githubJson(runtime, auth, "GET", `/repos/${owner}/${repo}/contents/${path}${qs}`);
    }
    case "fairlx_github_file_write": {
      const { owner, repo } = await resolveOwnerRepo(args, runtime, projectId);
      const path = requireString(args, "path");
      const content = requireString(args, "content");
      const branch = optionalString(args, "branch");
      const message = optionalString(args, "message") || `Update ${path}`;
      const encoded = Buffer.from(content, "utf-8").toString("base64");
      let sha: string | undefined;
      const existing = await requireGithub(runtime)({
        userId: auth.actorUserId,
        method: "GET",
        path: `/repos/${owner}/${repo}/contents/${path}${branch ? `?ref=${encodeURIComponent(branch)}` : ""}`,
      });
      if (existing.ok && existing.data && typeof existing.data === "object" && "sha" in existing.data) {
        sha = String((existing.data as { sha?: string }).sha || "");
      }
      return githubJson(runtime, auth, "PUT", `/repos/${owner}/${repo}/contents/${path}`, {
        message,
        content: encoded,
        branch,
        ...(sha ? { sha } : {}),
      });
    }
    case "fairlx_github_file_delete": {
      const { owner, repo } = await resolveOwnerRepo(args, runtime, projectId);
      const path = requireString(args, "path");
      const branch = optionalString(args, "branch");
      const existing = await requireGithub(runtime)({
        userId: auth.actorUserId,
        method: "GET",
        path: `/repos/${owner}/${repo}/contents/${path}${branch ? `?ref=${encodeURIComponent(branch)}` : ""}`,
      });
      const sha =
        existing.ok && existing.data && typeof existing.data === "object" && "sha" in existing.data
          ? String((existing.data as { sha?: string }).sha || "")
          : "";
      if (!sha) return toolResult({ error: `${path} was not found` }, true);
      return githubJson(runtime, auth, "DELETE", `/repos/${owner}/${repo}/contents/${path}`, {
        message: optionalString(args, "message") || `Delete ${path}`,
        sha,
        branch,
      });
    }
    case "fairlx_github_pr_list": {
      const { owner, repo } = await resolveOwnerRepo(args, runtime, projectId);
      const state = optionalString(args, "state") || "open";
      return githubJson(runtime, auth, "GET", `/repos/${owner}/${repo}/pulls?state=${encodeURIComponent(state)}`);
    }
    case "fairlx_github_pr_open": {
      const { owner, repo } = await resolveOwnerRepo(args, runtime, projectId);
      return githubJson(runtime, auth, "POST", `/repos/${owner}/${repo}/pulls`, {
        title: requireString(args, "title"),
        head: requireString(args, "head"),
        base: optionalString(args, "base") || "main",
        body: optionalString(args, "body") || "",
      });
    }
    case "fairlx_github_pr_merge": {
      const { owner, repo } = await resolveOwnerRepo(args, runtime, projectId);
      const pullNumber = args.pullNumber ?? args.number;
      if (typeof pullNumber !== "number" && typeof pullNumber !== "string") {
        throw invalidParams("pullNumber is required");
      }
      return githubJson(runtime, auth, "PUT", `/repos/${owner}/${repo}/pulls/${pullNumber}/merge`, {
        merge_method: optionalString(args, "mergeMethod") || "squash",
      });
    }
    case "fairlx_github_issue_list": {
      const { owner, repo } = await resolveOwnerRepo(args, runtime, projectId);
      const state = optionalString(args, "state") || "open";
      return githubJson(runtime, auth, "GET", `/repos/${owner}/${repo}/issues?state=${encodeURIComponent(state)}`);
    }
    case "fairlx_github_issue_create": {
      const { owner, repo } = await resolveOwnerRepo(args, runtime, projectId);
      return githubJson(runtime, auth, "POST", `/repos/${owner}/${repo}/issues`, {
        title: requireString(args, "title"),
        body: optionalString(args, "body") || "",
        labels: Array.isArray(args.labels) ? args.labels : undefined,
      });
    }
    case "fairlx_github_issue_comment": {
      const { owner, repo } = await resolveOwnerRepo(args, runtime, projectId);
      const issueNumber = args.issueNumber ?? args.number;
      if (issueNumber == null) throw invalidParams("issueNumber is required");
      return githubJson(runtime, auth, "POST", `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
        body: requireString(args, "body"),
      });
    }
    case "fairlx_github_issue_close": {
      const { owner, repo } = await resolveOwnerRepo(args, runtime, projectId);
      const issueNumber = args.issueNumber ?? args.number;
      if (issueNumber == null) throw invalidParams("issueNumber is required");
      return githubJson(runtime, auth, "PATCH", `/repos/${owner}/${repo}/issues/${issueNumber}`, { state: "closed" });
    }
    case "fairlx_github_branch_list": {
      const { owner, repo } = await resolveOwnerRepo(args, runtime, projectId);
      return githubJson(runtime, auth, "GET", `/repos/${owner}/${repo}/branches?per_page=100`);
    }
    default:
      throw invalidParams(`Unknown GitHub tool: ${name}`);
  }
}
