import type { AgentCapability, AgentContext } from "../types";

export function normalizeGitHubPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "").trim();
  if (!normalized) return "";
  return normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

export function parseGithubRepoRef(value?: string): { owner: string; repo: string } | undefined {
  if (!value?.trim()) return undefined;
  const cleaned = value.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  const fromUrl = cleaned.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (fromUrl) {
    return { owner: fromUrl[1]!, repo: fromUrl[2]!.replace(/\.git$/i, "") };
  }
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length === 2) return { owner: parts[0]!, repo: parts[1]! };
  return undefined;
}

const GITHUB_OWNER_REPO = /\b([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)\b/g;
const ATTACH_FROM_OWNER =
  /\b(?:connect|link|attach)\b[\s\S]{0,80}?\brepo(?:sitory)?\s+([A-Za-z0-9._-]+)\s+from\s+@?([A-Za-z0-9-]+)\b/i;
const REPO_FROM_OWNER = /\brepo(?:sitory)?\s+([A-Za-z0-9._-]+)\s+from\s+@?([A-Za-z0-9-]+)\b/i;

/** Parse “connect Fairlx-Dev from ancientinsane” or “ANCIENTINSANE/Fairlx-Dev”. */
export function parseGithubAttachRequest(text: string): { owner: string; repo: string } | undefined {
  const cleaned = (text || "").replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  const fromUrl = cleaned.match(/github\.com[/:]([^/]+)\/([^/#?\s]+)/i);
  if (fromUrl) {
    return { owner: fromUrl[1]!, repo: fromUrl[2]!.replace(/\.git$/i, "") };
  }
  const attachFrom = cleaned.match(ATTACH_FROM_OWNER) ?? cleaned.match(REPO_FROM_OWNER);
  if (attachFrom) {
    return { owner: attachFrom[2]!, repo: attachFrom[1]!.replace(/\.git$/i, "") };
  }
  const matches = [...cleaned.matchAll(GITHUB_OWNER_REPO)];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const owner = matches[i]![1]!;
    const repo = matches[i]![2]!.replace(/\.git$/i, "");
    if (/^(http|https|api|www)$/i.test(owner)) continue;
    if (repo.includes(".")) continue;
    return { owner, repo };
  }
  return undefined;
}

export function githubCapabilityGap(result: unknown): AgentCapability | undefined {
  if (!result || typeof result !== "object") return undefined;
  const rec = result as { error?: string; capability?: AgentCapability; skipped?: boolean; missing?: boolean };
  if (rec.missing) return undefined;
  if (rec.skipped) return undefined;
  if (rec.capability === "code.write" || rec.capability === "code.read" || rec.capability === "security.review") {
    return rec.capability;
  }
  if (typeof rec.error === "string" && /not connected|sign in with github|github_auth_required|fairlx profile/i.test(rec.error)) {
    return "code.write";
  }
  if (typeof rec.error === "string" && /token|cannot push/i.test(rec.error)) return "code.write";
  return undefined;
}

/** Do not pause the run for GitHub OAuth when the Fairlx profile already has a GitHub account. */
export function githubPauseCapability(
  accountConnected: boolean,
  result: unknown,
): AgentCapability | undefined {
  if (accountConnected) return undefined;
  return githubCapabilityGap(result);
}

export type GithubOwnerOption = { login: string; type?: string };

export function parseGithubOwnerChoiceResult(content: string): {
  githubLogin?: string;
  owners: GithubOwnerOption[];
} | undefined {
  try {
    const parsed = JSON.parse(content) as {
      needsOwnerChoice?: boolean;
      githubLogin?: string;
      owners?: GithubOwnerOption[];
    };
    if (!parsed || parsed.needsOwnerChoice !== true || !Array.isArray(parsed.owners) || !parsed.owners.length) {
      return undefined;
    }
    return {
      githubLogin: parsed.githubLogin,
      owners: parsed.owners.filter((item) => item && typeof item.login === "string" && item.login.trim()),
    };
  } catch {
    return undefined;
  }
}

export function pendingGithubOwnerChoice(
  messages: Array<{ role?: string; content?: string }>,
): { githubLogin?: string; owners: GithubOwnerOption[] } | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role !== "tool" || !message.content) continue;
    const parsed = parseGithubOwnerChoiceResult(message.content);
    if (parsed?.owners.length) return parsed;
  }
  return undefined;
}

export function matchGithubOwnerReply(reply: string, owners: GithubOwnerOption[]): string | undefined {
  const raw = (reply || "").trim().replace(/^@/, "");
  if (!raw) return undefined;
  const token = raw.split(/[\s,;|—–]+/)[0]?.replace(/[^A-Za-z0-9-]/g, "") || "";
  const needle = token.toLowerCase();
  if (!needle) return undefined;
  return owners.find((item) => item.login.toLowerCase() === needle)?.login;
}

export function githubRepoNameFromLabel(label: string): string {
  const slug = (label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug || "fairlx-project";
}

export function conversationWantsGithubCreateRepo(text: string): boolean {
  return (
    /\b(create|make|new)\b.{0,80}\b(github\s+)?repo(sitor(y|ies))?\b/i.test(text) ||
    /\bgithub\b.{0,40}\b(create|new)\b.{0,40}\brepo/i.test(text)
  );
}

export function githubCreateRepoArgsFromOwnerChoice(params: {
  owner: string;
  projectName?: string;
  projectKey?: string;
  private?: boolean;
}): {
  owner: string;
  name: string;
  autoInit: true;
  linkToProject: true;
  private: boolean;
  description?: string;
} {
  const name = githubRepoNameFromLabel(params.projectName || params.projectKey || "fairlx-project");
  return {
    owner: params.owner,
    name,
    autoInit: true,
    linkToProject: true,
    private: params.private !== false,
    description: params.projectName ? `${params.projectName} managed in Fairlx` : undefined,
  };
}

export function conversationWantsGithubVisibility(text: string): "private" | "public" | undefined {
  const raw = text || "";
  if (
    /\b(make|set|change|switch|convert|turn)\b.{0,40}\bprivate\b/i.test(raw) ||
    /\bprivate\s+(github\s+)?repo(sitory)?\b/i.test(raw) ||
    /\b(github\s+)?repo(sitory)?\b.{0,20}\bprivate\b/i.test(raw)
  ) {
    return "private";
  }
  if (
    /\b(make|set|change|switch|convert|turn)\b.{0,40}\bpublic\b/i.test(raw) ||
    /\bpublic\s+(github\s+)?repo(sitory)?\b/i.test(raw)
  ) {
    return "public";
  }
  return undefined;
}

export function githubBlobUrl(owner: string, repo: string, path: string, branch = "main"): string {
  const clean = path.replace(/^\/+/, "");
  return `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${clean
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

export function parseGithubRepoResult(content: string): { owner: string; repo: string; htmlUrl?: string } | undefined {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const fullName = typeof parsed.fullName === "string" ? parsed.fullName : typeof parsed.full_name === "string" ? parsed.full_name : "";
    const fromName = parseGithubRepoRef(fullName);
    const owner = typeof parsed.owner === "string" ? parsed.owner : fromName?.owner;
    const repo =
      typeof parsed.repo === "string"
        ? parsed.repo
        : typeof parsed.repositoryName === "string"
          ? parsed.repositoryName
          : fromName?.repo;
    if (!owner || !repo) return undefined;
    const htmlUrl =
      (typeof parsed.htmlUrl === "string" && parsed.htmlUrl) ||
      (typeof parsed.html_url === "string" && parsed.html_url) ||
      (typeof parsed.githubUrl === "string" && parsed.githubUrl) ||
      (typeof parsed.url === "string" && parsed.url) ||
      undefined;
    return { owner, repo, htmlUrl };
  } catch {
    return undefined;
  }
}

export function latestGithubRepoRef(
  messages: Array<{ role?: string; content?: string; toolName?: string }>,
): { owner: string; repo: string; htmlUrl?: string } | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role !== "tool" || !message.content) continue;
    const parsed = parseGithubRepoResult(message.content);
    if (parsed) return parsed;
    const fromText = parseGithubRepoRef(message.content) ?? parseGithubAttachRequest(message.content);
    if (fromText) return fromText;
    const url = message.content.match(/github\.com[/:]([^/\s"'<>]+)\/([^/\s"'<>?#]+)/i);
    if (url) return { owner: url[1]!, repo: url[2]!.replace(/\.git$/i, "") };
  }
  return undefined;
}

export function mergeProjectGithubRepo(
  context: AgentContext,
  linked: {
    projectId: string;
    workspaceId?: string;
    owner: string;
    repo: string;
    githubUrl?: string;
    branch?: string;
  },
): AgentContext {
  const githubUrl = linked.githubUrl || `https://github.com/${linked.owner}/${linked.repo}`;
  return {
    ...context,
    githubRepos: [
      ...context.githubRepos.filter((repo) => repo.projectId !== linked.projectId),
      {
        id: githubUrl,
        owner: linked.owner,
        repositoryName: linked.repo,
        githubUrl,
        projectId: linked.projectId,
        workspaceId: linked.workspaceId || "",
        branch: linked.branch || "main",
      },
    ],
  };
}

export function parsePrFiles(value: unknown): Array<{ path: string; content: string; message?: string }> {
  if (!Array.isArray(value)) return [];
  const files: Array<{ path: string; content: string; message?: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const path = typeof rec.path === "string" ? rec.path : "";
    const content = typeof rec.content === "string" ? rec.content : "";
    if (!path || !content) continue;
    files.push({
      path,
      content,
      message: typeof rec.message === "string" ? rec.message : undefined,
    });
  }
  return files;
}
