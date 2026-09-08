import { GITHUB_API_BASE } from "../constants";

/** Decode a GitHub path once so `%28portal%29` becomes `(portal)` and we never double-encode. */
export function decodeGitHubContentsPath(path: string): string {
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

/**
 * Encode one GitHub Contents URL segment at a time.
 * Leave `()` as-is (Next.js route groups). Encode `[]` and spaces.
 */
export function encodeGitHubContentsPath(path: string): string {
  const decoded = decodeGitHubContentsPath(path);
  if (!decoded) return "";
  return decoded.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

type GitTreeEntry = {
  path: string;
  type?: string;
  sha?: string;
  size?: number;
};

export function listGitTreeChildren(tree: GitTreeEntry[], dirPath: string): Array<{
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  sha: string;
}> {
  const prefix = dirPath ? `${dirPath.replace(/\/+$/, "")}/` : "";
  const seen = new Map<string, { name: string; path: string; type: "file" | "dir"; size: number; sha: string }>();
  for (const entry of tree) {
    const entryPath = entry.path || "";
    if (prefix && !entryPath.startsWith(prefix)) continue;
    const rest = prefix ? entryPath.slice(prefix.length) : entryPath;
    if (!rest) continue;
    const slash = rest.indexOf("/");
    const name = slash === -1 ? rest : rest.slice(0, slash);
    const childPath = `${prefix}${name}`;
    const isDirectFile = slash === -1 && entry.type === "blob";
    const current = seen.get(name);
    if (isDirectFile) {
      seen.set(name, {
        name,
        path: childPath,
        type: "file",
        size: entry.size ?? 0,
        sha: entry.sha || "",
      });
    } else if (!current || current.type !== "file") {
      seen.set(name, {
        name,
        path: childPath,
        type: "dir",
        size: 0,
        sha: entry.sha || current?.sha || "",
      });
    }
  }
  return [...seen.values()];
}

const gitTreeCache = new Map<string, { at: number; tree: GitTreeEntry[] }>();
const gitTreeInflight = new Map<string, Promise<GitTreeEntry[]>>();
const GIT_TREE_TTL_MS = 60_000;

function stubContent(item: {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  sha: string;
}): GitHubFileContent {
  return {
    name: item.name,
    path: item.path,
    sha: item.sha,
    size: item.size,
    url: "",
    html_url: "",
    git_url: "",
    download_url: null,
    type: item.type,
  };
}

interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: "file" | "dir";
  content?: string;
  encoding?: string;
}

interface GitHubCommit {
  sha: string;
  html_url: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
  author: {
    login: string;
    avatar_url: string;
  } | null;
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
  files?: Array<{
    filename: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
}

export class GitHubAPI {
  private token: string;

  constructor(token?: string) {
    this.token = token || process.env.GH_PERSONAL_TOKEN || "";
  }

  getAccessToken(): string {
    return this.token;
  }

  private getHeaders() {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Fairlx-App",
    };
    
    if (this.token) {
      headers.Authorization = `token ${this.token}`;
    }
    
    return headers;
  }

  private async fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
    try {
      const response = await fetch(url, options);
      
      // Retry on 429 (Rate Limit), 403 (could be secondary rate limit), or 5xx
      if ((response.status === 429 || response.status === 403 || response.status >= 500) && retries > 0) {
        // If it's a 403, we should check if it's actually a rate limit
        // Secondary rate limits often return 403
        const retryAfter = response.headers.get("Retry-After");
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : 1000 * (4 - retries);
        
        // Capped delay consistent with Gemini logic
        const waitTime = Math.min(delay, 5000); 
        
        await new Promise(r => setTimeout(r, waitTime));
        return this.fetchWithRetry(url, options, retries - 1);
      }
      
      return response;
    } catch (error) {
      if (retries > 0) {
        // Retry on connection errors
        await new Promise(r => setTimeout(r, 1000 * (4 - retries)));
        return this.fetchWithRetry(url, options, retries - 1);
      }
      throw error;
    }
  }

  private async loadGitTree(owner: string, repo: string, branch: string): Promise<GitTreeEntry[]> {
    const key = `${owner}/${repo}:${branch}`;
    const cached = gitTreeCache.get(key);
    if (cached && Date.now() - cached.at < GIT_TREE_TTL_MS) return cached.tree;
    const inflight = gitTreeInflight.get(key);
    if (inflight) return inflight;
    const pending = (async () => {
      const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
      const response = await this.fetchWithRetry(url, { headers: this.getHeaders() });
      if (!response.ok) return [];
      const data = (await response.json()) as { tree?: GitTreeEntry[] };
      const tree = Array.isArray(data.tree) ? data.tree : [];
      gitTreeCache.set(key, { at: Date.now(), tree });
      return tree;
    })().finally(() => {
      gitTreeInflight.delete(key);
    });
    gitTreeInflight.set(key, pending);
    return pending;
  }

  private async contentsFromGitTree(
    owner: string,
    repo: string,
    path: string,
    branch: string,
  ): Promise<GitHubFileContent[] | null> {
    const tree = await this.loadGitTree(owner, repo, branch);
    if (!tree.length) return null;
    const decoded = decodeGitHubContentsPath(path);
    const blob = tree.find((entry) => entry.path === decoded && entry.type === "blob");
    if (blob) {
      return [
        stubContent({
          name: blob.path.split("/").pop() || blob.path,
          path: blob.path,
          type: "file",
          size: blob.size ?? 0,
          sha: blob.sha || "",
        }),
      ];
    }
    const children = listGitTreeChildren(tree, decoded);
    if (children.length) return children.map(stubContent);
    if (tree.some((entry) => entry.path === decoded && entry.type === "tree")) return [];
    return null;
  }

  private async readBlob(owner: string, repo: string, sha: string): Promise<string> {
    const response = await this.fetchWithRetry(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/blobs/${sha}`,
      { headers: this.getHeaders() },
    );
    if (!response.ok) {
      throw new Error(`Failed to read git blob ${sha}: ${response.statusText}`);
    }
    const data = (await response.json()) as { content?: string; encoding?: string };
    if (!data.content) throw new Error(`Content not available for blob ${sha}`);
    if ((data.encoding || "base64") === "base64") {
      return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
    }
    return data.content;
  }

  /**
   * Parse GitHub URL to extract owner and repo
   */
  parseGitHubUrl(url: string): { owner: string; repo: string } {
    try {
      const cleanUrl = url.replace(/\.git$/, "").replace(/\/$/, "");
      const match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      
      if (!match) {
        throw new Error("Invalid GitHub URL format");
      }

      return {
        owner: match[1]!,
        repo: match[2]!,
      };
    } catch {
      throw new Error("Failed to parse GitHub URL");
    }
  }

  /**
   * Get repository information
   */
  async getRepository(owner: string, repo: string) {
    const response = await this.fetchWithRetry(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("REPO_NOT_FOUND");
      }
      if (response.status === 403) {
        // Log the 403 body for debugging
        try {
          const errorBody = await response.json();
          console.error("[GitHub API 403 Error]:", errorBody);
          
          if (errorBody.message?.includes("rate limit")) {
            throw new Error("GITHUB_RATE_LIMIT");
          }
          
          throw new Error(`ACCESS_DENIED: ${errorBody.message || "Forbidden"}`);
        } catch {
          throw new Error("ACCESS_DENIED");
        }
      }
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      ...data,
      private: data.private || false,
    };
  }

  /**
   * Check if repository is accessible with current token
   */
  async checkRepositoryAccess(owner: string, repo: string): Promise<{
    accessible: boolean;
    isPrivate: boolean;
    needsToken: boolean;
    error?: string;
  }> {
    try {
      const repoData = await this.getRepository(owner, repo);
      return {
        accessible: true,
        isPrivate: repoData.private,
        needsToken: false,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      if (errorMessage === "REPO_NOT_FOUND") {
        // Could be private or doesn't exist
        return {
          accessible: false,
          isPrivate: true, // Assume private since we can't access
          needsToken: true,
          error: "Repository not found or private. Token required.",
        };
      }
      
      if (errorMessage === "ACCESS_DENIED") {
        return {
          accessible: false,
          isPrivate: true,
          needsToken: true,
          error: "Access denied. This is a private repository. Token required.",
        };
      }
      
      return {
        accessible: false,
        isPrivate: false,
        needsToken: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get repository contents
   */
  async getContents(
    owner: string,
    repo: string,
    path: string = "",
    branch: string = "main"
  ): Promise<GitHubFileContent[]> {
    const decoded = decodeGitHubContentsPath(path);
    const encodedPath = encodeGitHubContentsPath(decoded);
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
    
    const response = await this.fetchWithRetry(url, { headers: this.getHeaders() });

    if (response.ok) {
      const data = await response.json();
      return Array.isArray(data) ? data : [data];
    }

    if (response.status === 404) {
      if (branch === "main" && !decoded) {
        return this.getContents(owner, repo, path, "master");
      }
      const fromTree = await this.contentsFromGitTree(owner, repo, decoded, branch);
      if (fromTree) return fromTree;
      throw new Error(`Path not found in repository: ${decoded || "/"} on ${branch}`);
    }
    throw new Error(`Failed to fetch contents: ${response.statusText}`);
  }

  /**
   * Get file content (decoded)
   */
  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    branch: string = "main"
  ): Promise<string> {
    const decoded = decodeGitHubContentsPath(path);
    const contents = await this.getContents(owner, repo, decoded, branch);
    const file = contents[0];

    if (!file || file.type !== "file") {
      throw new Error(`Invalid file type for ${decoded}`);
    }

    if (file.content) {
      return Buffer.from(file.content, "base64").toString("utf-8");
    }

    if (file.sha) {
      try {
        return await this.readBlob(owner, repo, file.sha);
      } catch {
        // Fall through to download_url when the blob endpoint is unavailable.
      }
    }

    if (file.download_url) {
      const response = await this.fetchWithRetry(file.download_url, {});
      if (!response.ok) {
        throw new Error(`Failed to download file from ${file.download_url}`);
      }
      return await response.text();
    }

    throw new Error(`Content not available for ${decoded}`);
  }

  /**
   * Recursively get all files in repository
   */
  async getAllFiles(
    owner: string,
    repo: string,
    branch: string = "main",
    path: string = "",
    maxFiles: number = 100
  ): Promise<Array<{ path: string; content: string; type: string }>> {
    const files: Array<{ path: string; content: string; type: string }> = [];
    
    try {
      const contents = await this.getContents(owner, repo, path, branch);

      // Parallelize file content fetching with a concurrency limit
      const CONCURRENCY_LIMIT = 5;

      const processItem = async (item: GitHubFileContent) => {
        // Skip common directories that don't need analysis
        if (
          item.type === "dir" &&
          (item.name.startsWith(".") ||
            ["node_modules", "dist", "build", "vendor", "__pycache__", ".git", ".next"].includes(
              item.name
            ))
        ) {
          return;
        }

        if (item.type === "file") {
          if (files.length >= maxFiles) return;

          // Only process code files
          const codeExtensions = [
            ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs", ".cpp", ".c", ".h", ".cs", ".rb", ".php", ".swift", ".kt", ".md", ".json", ".yaml", ".yml",
          ];

          if (codeExtensions.some((ext) => item.name.endsWith(ext))) {
            try {
              const content = await this.getFileContent(owner, repo, item.path, branch);
              files.push({
                path: item.path,
                content: content.slice(0, 10000), // Limit content size
                type: item.name.split(".").pop() || "unknown",
              });
            } catch (e) {
              console.warn(`[GitHub API] Failed to fetch file ${item.path}:`, e);
            }
          }
        } else if (item.type === "dir") {
          try {
            const subFiles = await this.getAllFiles(
              owner,
              repo,
              branch,
              item.path,
              maxFiles
            );
            // Deduplicate and limit
            for (const f of subFiles) {
              if (files.length < maxFiles && !files.find(existing => existing.path === f.path)) {
                files.push(f);
              }
            }
          } catch (e) {
             console.warn(`[GitHub API] Failed to fetch dir ${item.path}:`, e);
          }
        }
      };

      // Concurrency worker implementation
      const pool = [...contents];
      const workers = Array(Math.min(CONCURRENCY_LIMIT, pool.length)).fill(null).map(async () => {
        while (pool.length > 0 && files.length < maxFiles) {
          const item = pool.shift();
          if (item) {
            await processItem(item);
          }
        }
      });

      await Promise.all(workers);
    } catch (e) {
      console.error("[GitHub API] Error in getAllFiles:", e);
    }

    return files;
  }

  /**
   * Get recent commits with file details (optimized for batch requests with pagination)
   * Fetches detailed information for ALL commits
   */
  async getCommits(
    owner: string,
    repo: string,
    branch: string = "main",
    limit: number = 500
  ): Promise<GitHubCommit[]> {
    const perPage = 100; // GitHub API max per page
    const allCommits: GitHubCommit[] = [];
    let page = 1;
    
    try {
      while (allCommits.length < limit) {
        const remaining = limit - allCommits.length;
        const pageSize = Math.min(remaining, perPage);
        
        // Fetch commits with basic info (1 API call per page)
        const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?sha=${branch}&per_page=${pageSize}&page=${page}`;
        
        const response = await this.fetchWithRetry(url, { headers: this.getHeaders() });

        if (!response.ok) {
          if (response.status === 404 && branch === "main" && page === 1) {
            return this.getCommits(owner, repo, "master", limit);
          }
          throw new Error(`Failed to fetch commits: ${response.statusText}`);
        }

        const commits = await response.json();
        
        // If no more commits, break
        if (!commits || commits.length === 0) {
          break;
        }
        
        // Fetch detailed info for ALL commits with file changes
        const batchSize = 10;
        const detailedCommits: GitHubCommit[] = [];
        
        for (let i = 0; i < commits.length; i += batchSize) {
          const batch = commits.slice(i, i + batchSize);
          const batchResults = await Promise.all(
            batch.map(async (commit: GitHubCommit) => {
              try {
                const detailUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/${commit.sha}`;
                const detailResponse = await this.fetchWithRetry(detailUrl, { headers: this.getHeaders() });
                
                if (!detailResponse.ok) {
                  return commit; // Return basic commit if details fail
                }
                
                return await detailResponse.json();
              } catch {
                return commit;
              }
            })
          );
          detailedCommits.push(...batchResults);
          
          // Small delay between batches to avoid rate limiting
          if (i + batchSize < commits.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        // Add all detailed commits
        allCommits.push(...detailedCommits);
        
        // If we got fewer commits than requested, we've reached the end
        if (commits.length < pageSize) {
          break;
        }
        
        page++;
        
        // Small delay between pages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      return allCommits.slice(0, limit);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get single commit with details
   */
  async getCommit(
    owner: string,
    repo: string,
    sha: string
  ): Promise<GitHubCommit> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/${sha}`;
    
    const response = await this.fetchWithRetry(url, { headers: this.getHeaders() });

    if (!response.ok) {
      throw new Error(`Failed to fetch commit: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get commit diff
   */
  async getCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/${sha}`;
    
    const response = await this.fetchWithRetry(url, {
      headers: {
        ...this.getHeaders(),
        Accept: "application/vnd.github.v3.diff",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch commit diff: ${response.statusText}`);
    }

    return response.text();
  }

  /**
   * Generate file tree structure
   */
  generateFileTree(files: Array<{ path: string }>): string {
    const tree: Record<string, unknown> = {};

    files.forEach((file) => {
      const parts = file.path.split("/");
      let current: Record<string, unknown> = tree;

      parts.forEach((part, index) => {
        if (index === parts.length - 1) {
          current[part] = null; // File
        } else {
          current[part] = current[part] || {};
          current = current[part] as Record<string, unknown>;
        }
      });
    });

    const buildTreeString = (obj: Record<string, unknown>, prefix: string = ""): string => {
      const entries = Object.entries(obj);
      return entries
        .map(([key, value], index) => {
          const isLast = index === entries.length - 1;
          const connector = isLast ? "`-- " : "|-- ";
          const newPrefix = prefix + (isLast ? "    " : "|   ");

          if (value === null) {
            return `${prefix}${connector}${key}`;
          } else {
            return `${prefix}${connector}${key}/\n${buildTreeString(
              value as Record<string, unknown>,
              newPrefix
            )}`;
          }
        })
        .join("\n");
    };

    return buildTreeString(tree);
  }

  /**
   * Generate Mermaid diagram from file structure
   */
  generateMermaidDiagram(files: Array<{ path: string }>): string {
    const directories = new Set<string>();
    const filesByDir: Record<string, string[]> = {};

    files.forEach((file) => {
      const parts = file.path.split("/");
      
      if (parts.length === 1) {
        filesByDir["root"] = filesByDir["root"] || [];
        filesByDir["root"].push(parts[0]!);
      } else {
        const dir = parts.slice(0, -1).join("/");
        const fileName = parts[parts.length - 1]!;
        
        directories.add(dir);
        filesByDir[dir] = filesByDir[dir] || [];
        filesByDir[dir].push(fileName);
      }
    });

    let mermaid = "graph TD\n";
    mermaid += "    Root[Project Root]\n";

    Array.from(directories)
      .slice(0, 20)
      .forEach((dir) => {
        const dirId = dir.replace(/[\/\-\.]/g, "_");
        const dirName = dir.split("/").pop() || dir;
        mermaid += `    ${dirId}["[DIR] ${dirName}"]\n`;
        
        const parentDir = dir.split("/").slice(0, -1).join("/");
        const parentId = parentDir ? parentDir.replace(/[\/\-\.]/g, "_") : "Root";
        mermaid += `    ${parentId} --> ${dirId}\n`;
      });

    return mermaid;
  }

  // ─── Webhook Management ──────────────────

  /**
   * Register a webhook on a GitHub repository.
   * Returns the webhook ID for later deletion.
   */
  async registerWebhook(
    owner: string,
    repo: string,
    webhookUrl: string,
    secret: string,
    events: string[] = ["push", "pull_request", "issues", "release"]
  ): Promise<{ id: number; url: string }> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/hooks`;

    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "web",
        active: true,
        events,
        config: {
          url: webhookUrl,
          content_type: "json",
          secret,
          insecure_ssl: "0",
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to register webhook: ${response.statusText} - ${JSON.stringify(errorBody)}`
      );
    }

    const data = await response.json() as { id: number; url: string };
    return { id: data.id, url: data.url };
  }

  /**
   * Delete a webhook from a GitHub repository.
   */
  async deleteWebhook(
    owner: string,
    repo: string,
    hookId: number
  ): Promise<void> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/hooks/${hookId}`;

    const response = await this.fetchWithRetry(url, {
      method: "DELETE",
      headers: this.getHeaders(),
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete webhook: ${response.statusText}`);
    }
  }

  /**
   * Update a webhook configuration on a GitHub repository.
   */
  async updateWebhook(
    owner: string,
    repo: string,
    hookId: number,
    webhookUrl: string,
    secret: string,
    events: string[] = ["push", "pull_request", "issues", "release"]
  ): Promise<void> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/hooks/${hookId}`;

    const response = await this.fetchWithRetry(url, {
      method: "PATCH",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        active: true,
        events,
        config: {
          url: webhookUrl,
          content_type: "json",
          secret,
          insecure_ssl: "0",
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to update webhook: ${response.status} ${response.statusText} - ${JSON.stringify(errorBody)}`
      );
    }
  }

  /**
   * List webhooks on a GitHub repository.
   */
  async listWebhooks(
    owner: string,
    repo: string
  ): Promise<Array<{ id: number; config: { url: string }; events: string[]; active: boolean }>> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/hooks`;

    const response = await this.fetchWithRetry(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to list webhooks: ${response.statusText}`);
    }

    return response.json();
  }

  // ─── Pull Requests ──────────────────

  /**
   * List pull requests for a repository.
   */
  async listPullRequests(
    owner: string,
    repo: string,
    state: "open" | "closed" | "all" = "open",
    perPage: number = 30
  ): Promise<Array<{
    number: number;
    title: string;
    state: string;
    html_url: string;
    user: { login: string; avatar_url: string };
    head: { ref: string };
    base: { ref: string };
    created_at: string;
    updated_at: string;
    merged_at: string | null;
  }>> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls?state=${state}&per_page=${perPage}`;

    const response = await this.fetchWithRetry(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to list pull requests: ${response.statusText}`);
    }

    return response.json();
  }

  // ─── Issues ──────────────────

  /**
   * Get a single issue from a repository.
   */
  async getIssue(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<{
    number: number;
    title: string;
    state: string;
    html_url: string;
    body: string | null;
    labels: Array<{ name: string; color: string }>;
    assignees: Array<{ login: string; avatar_url: string }>;
  }> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`;

    const response = await this.fetchWithRetry(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get issue #${issueNumber}: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * List issues for a repository.
   */
  async listIssues(
    owner: string,
    repo: string,
    state: "open" | "closed" | "all" = "all",
    perPage: number = 100
  ): Promise<Array<{
    id: number;
    number: number;
    title: string;
    state: string;
    html_url: string;
    body: string | null;
    labels: Array<{ name: string; color: string }>;
    assignees: Array<{ login: string; avatar_url: string }>;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    pull_request?: Record<string, unknown>;
  }>> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}`;

    const response = await this.fetchWithRetry(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to list issues: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * List releases for a repository.
   */
  async listReleases(
    owner: string,
    repo: string,
    perPage: number = 100
  ): Promise<Array<{
    id: number;
    tag_name: string;
    name: string;
    body: string | null;
    published_at: string;
    html_url: string;
    author: { login: string };
  }>> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases?per_page=${perPage}`;

    const response = await this.fetchWithRetry(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to list releases: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * List repositories accessible to the user
   */
  async listUserRepositories(): Promise<Array<{
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    html_url: string;
    description?: string | null;
    owner: { login: string };
    default_branch: string;
  }>> {
    const url = `${GITHUB_API_BASE}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`;
    const response = await this.fetchWithRetry(url, { headers: this.getHeaders() });
    if (!response.ok) {
      throw new Error(`Failed to list repositories: ${response.statusText}`);
    }
    return response.json();
  }

  async searchRepositories(query: string): Promise<Array<{
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    html_url: string;
    description?: string | null;
    owner: { login: string };
    default_branch: string;
  }>> {
    const q = query.trim();
    if (!q) return [];
    const url = `${GITHUB_API_BASE}/search/repositories?q=${encodeURIComponent(q)}&per_page=30`;
    const response = await this.fetchWithRetry(url, { headers: this.getHeaders() });
    if (!response.ok) {
      throw new Error(`Failed to search repositories: ${response.statusText}`);
    }
    const payload = (await response.json()) as { items?: Array<{
      id: number;
      name: string;
      full_name: string;
      private: boolean;
      html_url: string;
      description?: string | null;
      owner: { login: string };
      default_branch: string;
    }> };
    return payload.items ?? [];
  }

  async getAuthenticatedUser(): Promise<{ login: string; id: number; type?: string }> {
    const url = `${GITHUB_API_BASE}/user`;
    const response = await this.fetchWithRetry(url, { headers: this.getHeaders() });
    if (!response.ok) {
      throw new Error(`Failed to load GitHub user: ${response.statusText}`);
    }
    return response.json();
  }

  async listUserOrganizations(): Promise<Array<{ login: string; id: number; description?: string | null }>> {
    const url = `${GITHUB_API_BASE}/user/orgs?per_page=100`;
    const response = await this.fetchWithRetry(url, { headers: this.getHeaders() });
    if (!response.ok) {
      throw new Error(`Failed to list GitHub organizations: ${response.statusText}`);
    }
    return response.json();
  }

  async createRepository(params: {
    name: string;
    owner?: string;
    description?: string;
    private?: boolean;
    autoInit?: boolean;
  }): Promise<{
    name: string;
    full_name: string;
    html_url: string;
    private: boolean;
    default_branch: string;
    owner: { login: string };
  }> {
    const login = (await this.getAuthenticatedUser()).login;
    const owner = (params.owner || "").trim();
    const isOrg = owner && owner.toLowerCase() !== login.toLowerCase();
    const url = isOrg ? `${GITHUB_API_BASE}/orgs/${owner}/repos` : `${GITHUB_API_BASE}/user/repos`;
    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: params.name,
        description: params.description || undefined,
        private: Boolean(params.private),
        auto_init: params.autoInit !== false,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text.slice(0, 400) || `Failed to create repository: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * List branches for a repository
   */
  async listBranches(owner: string, repo: string): Promise<Array<{
    name: string;
    commit: { sha: string };
    protected: boolean;
  }>> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/branches?per_page=100`;
    const response = await this.fetchWithRetry(url, { headers: this.getHeaders() });
    if (!response.ok) {
      throw new Error(`Failed to list branches: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Close an issue on GitHub
   */
  async closeIssue(owner: string, repo: string, issueNumber: number): Promise<void> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`;
    const response = await this.fetchWithRetry(url, {
      method: "PATCH",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state: "closed" }),
    });
    if (!response.ok) {
      throw new Error(`Failed to close issue #${issueNumber}: ${response.statusText}`);
    }
  }

  /**
   * Create a comment on an issue or PR
   */
  async createIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<{ html_url: string; id: number }> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    });
    if (!response.ok) {
      throw new Error(`Failed to create comment on issue #${issueNumber}: ${response.statusText}`);
    }
    const json = (await response.json()) as { html_url?: string; id?: number };
    return { html_url: json.html_url || "", id: json.id || 0 };
  }

  async getBranchSha(owner: string, repo: string, branch: string): Promise<string> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
    const response = await this.fetchWithRetry(url, { headers: this.getHeaders() });
    if (!response.ok) {
      throw new Error(`Failed to read branch ${branch}: ${response.statusText}`);
    }
    const json = (await response.json()) as { object?: { sha?: string } };
    const sha = json.object?.sha;
    if (!sha) throw new Error(`Branch ${branch} has no sha`);
    return sha;
  }

  async ensureBranch(owner: string, repo: string, branch: string, fromBranch: string): Promise<void> {
    try {
      await this.getBranchSha(owner, repo, branch);
      return;
    } catch {
      // create from base
    }
    const sha = await this.getBranchSha(owner, repo, fromBranch);
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs`;
    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: { ...this.getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    });
    if (!response.ok && response.status !== 422) {
      throw new Error(`Failed to create branch ${branch}: ${response.statusText}`);
    }
  }

  async putFile(params: {
    owner: string;
    repo: string;
    path: string;
    content: string;
    message: string;
    branch: string;
    baseBranch?: string;
  }): Promise<{ sha: string; html_url?: string }> {
    if (params.baseBranch) {
      await this.ensureBranch(params.owner, params.repo, params.branch, params.baseBranch);
    }
    let sha: string | undefined;
    try {
      const existing = await this.getContents(params.owner, params.repo, params.path, params.branch);
      sha = existing[0]?.sha;
    } catch {
      sha = undefined;
    }
    const url = `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/contents/${params.path}`;
    const response = await this.fetchWithRetry(url, {
      method: "PUT",
      headers: { ...this.getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: params.message,
        content: Buffer.from(params.content, "utf-8").toString("base64"),
        branch: params.branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text.slice(0, 400) || `Failed to write ${params.path}: ${response.statusText}`);
    }
    const json = (await response.json()) as { content?: { sha?: string; html_url?: string } };
    return { sha: json.content?.sha || "", html_url: json.content?.html_url };
  }

  async createPullRequest(params: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<{ number: number; html_url: string; title: string }> {
    const url = `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/pulls`;
    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: { ...this.getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text.slice(0, 400) || `Failed to open pull request: ${response.statusText}`);
    }
    const json = (await response.json()) as { number: number; html_url: string; title: string };
    return { number: json.number, html_url: json.html_url, title: json.title };
  }

  async compareCommits(owner: string, repo: string, base: string, head: string): Promise<{
    html_url?: string;
    ahead_by: number;
    behind_by: number;
    files: Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      changes: number;
      patch?: string;
    }>;
  }> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
    const response = await this.fetchWithRetry(url, { headers: this.getHeaders() });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text.slice(0, 400) || `Failed to compare ${base}...${head}`);
    }
    const json = (await response.json()) as {
      html_url?: string;
      ahead_by?: number;
      behind_by?: number;
      files?: Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        changes: number;
        patch?: string;
      }>;
    };
    return {
      html_url: json.html_url,
      ahead_by: json.ahead_by ?? 0,
      behind_by: json.behind_by ?? 0,
      files: json.files ?? [],
    };
  }

  async listPullRequestFiles(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<
    Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      changes: number;
      patch?: string;
    }>
  > {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`;
    const response = await this.fetchWithRetry(url, { headers: this.getHeaders() });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text.slice(0, 400) || `Failed to list PR files: ${response.statusText}`);
    }
    return (await response.json()) as Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      changes: number;
      patch?: string;
    }>;
  }

  async createReview(params: {
    owner: string;
    repo: string;
    pullNumber: number;
    body?: string;
    event?: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  }): Promise<{ id: number; html_url?: string }> {
    const url = `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/reviews`;
    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: { ...this.getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        body: params.body || "",
        event: params.event || "COMMENT",
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text.slice(0, 400) || `Failed to create review: ${response.statusText}`);
    }
    const json = (await response.json()) as { id: number; html_url?: string };
    return { id: json.id, html_url: json.html_url };
  }

  async createReviewComment(params: {
    owner: string;
    repo: string;
    pullNumber: number;
    body: string;
    path: string;
    line: number;
    side?: "LEFT" | "RIGHT";
    commitId?: string;
  }): Promise<{ id: number; html_url?: string }> {
    let commitId = params.commitId;
    if (!commitId) {
      const prUrl = `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}`;
      const prResponse = await this.fetchWithRetry(prUrl, { headers: this.getHeaders() });
      if (!prResponse.ok) {
        const text = await prResponse.text();
        throw new Error(text.slice(0, 400) || "Failed to load pull request for review comment");
      }
      const pr = (await prResponse.json()) as { head?: { sha?: string } };
      commitId = pr.head?.sha;
    }
    const url = `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/comments`;
    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: { ...this.getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        body: params.body,
        path: params.path,
        line: params.line,
        side: params.side || "RIGHT",
        commit_id: commitId,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text.slice(0, 400) || `Failed to create review comment: ${response.statusText}`);
    }
    const json = (await response.json()) as { id: number; html_url?: string };
    return { id: json.id, html_url: json.html_url };
  }

  async listCheckRuns(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<Array<{ name: string; status: string; conclusion: string | null; html_url?: string }>> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}/check-runs`;
    const response = await this.fetchWithRetry(url, {
      headers: { ...this.getHeaders(), Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text.slice(0, 400) || `Failed to list check runs: ${response.statusText}`);
    }
    const json = (await response.json()) as {
      check_runs?: Array<{ name: string; status: string; conclusion: string | null; html_url?: string }>;
    };
    return json.check_runs ?? [];
  }

  async mergePullRequest(params: {
    owner: string;
    repo: string;
    pullNumber: number;
    commitTitle?: string;
    mergeMethod?: "merge" | "squash" | "rebase";
  }): Promise<{ merged: boolean; sha?: string; message?: string; html_url?: string }> {
    const url = `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/merge`;
    const response = await this.fetchWithRetry(url, {
      method: "PUT",
      headers: { ...this.getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        commit_title: params.commitTitle,
        merge_method: params.mergeMethod || "squash",
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text.slice(0, 400) || `Failed to merge pull request: ${response.statusText}`);
    }
    return (await response.json()) as { merged: boolean; sha?: string; message?: string; html_url?: string };
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
    const url = path.startsWith("http")
      ? path
      : `${GITHUB_API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
    const response = await this.fetchWithRetry(url, {
      method,
      headers: {
        ...this.getHeaders(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    if (!response.ok) {
      const message =
        data && typeof data === "object" && "message" in data
          ? String((data as { message?: unknown }).message || "")
          : text.slice(0, 400);
      return { ok: false, status: response.status, error: message || response.statusText, data: data as T };
    }
    return { ok: true, status: response.status, data: data as T };
  }

  async updateRepository(params: {
    owner: string;
    repo: string;
    private?: boolean;
    description?: string;
    homepage?: string;
    name?: string;
  }): Promise<{
    full_name: string;
    html_url: string;
    private: boolean;
    description: string | null;
    default_branch: string;
  }> {
    const body: Record<string, unknown> = {};
    if (typeof params.private === "boolean") body.private = params.private;
    if (params.description !== undefined) body.description = params.description;
    if (params.homepage !== undefined) body.homepage = params.homepage;
    if (params.name) body.name = params.name;
    const result = await this.request<{
      full_name: string;
      html_url: string;
      private: boolean;
      description: string | null;
      default_branch: string;
    }>("PATCH", `/repos/${params.owner}/${params.repo}`, body);
    if (!result.ok || !result.data) {
      throw new Error(result.error || "Failed to update repository");
    }
    return result.data;
  }

  async deleteFile(params: {
    owner: string;
    repo: string;
    path: string;
    message: string;
    branch: string;
    sha: string;
  }): Promise<{ html_url?: string }> {
    const result = await this.request<{ content?: { html_url?: string } | null }>(
      "DELETE",
      `/repos/${params.owner}/${params.repo}/contents/${params.path}`,
      {
        message: params.message,
        sha: params.sha,
        branch: params.branch,
      },
    );
    if (!result.ok) {
      throw new Error(result.error || `Failed to delete ${params.path}`);
    }
    return { html_url: result.data?.content?.html_url };
  }

  async createIssue(params: {
    owner: string;
    repo: string;
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<{ number: number; html_url: string; title: string; state: string }> {
    const result = await this.request<{ number: number; html_url: string; title: string; state: string }>(
      "POST",
      `/repos/${params.owner}/${params.repo}/issues`,
      {
        title: params.title,
        body: params.body,
        labels: params.labels,
        assignees: params.assignees,
      },
    );
    if (!result.ok || !result.data) {
      throw new Error(result.error || "Failed to create issue");
    }
    return result.data;
  }

  async requestReviewers(params: {
    owner: string;
    repo: string;
    pullNumber: number;
    reviewers: string[];
  }): Promise<{ requested: string[] }> {
    const url = `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/requested_reviewers`;
    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: { ...this.getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ reviewers: params.reviewers }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text.slice(0, 400) || `Failed to request reviewers: ${response.statusText}`);
    }
    const json = (await response.json()) as { requested_reviewers?: Array<{ login: string }> };
    return { requested: (json.requested_reviewers ?? []).map((item) => item.login) };
  }
}

export const githubAPI = new GitHubAPI();

