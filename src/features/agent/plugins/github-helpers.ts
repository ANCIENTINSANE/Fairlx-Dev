import type { AgentCapability } from "../types";

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
