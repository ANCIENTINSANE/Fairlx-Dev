import type { AgentToolEvent } from "../types";
import { githubBlobUrl, parseGithubRepoRef } from "../plugins/github-helpers";
import { isStubPreviewUrl } from "./sandbox-preview";
import type { TranscriptStep } from "./transcript";

export type GithubArtifact = {
  id: string;
  label: string;
  href: string;
  kind: "file" | "repo" | "pr" | "issue" | "preview";
};

const SKIP_GITHUB_TOOLS = /^(github_list_|github_account_status$)/;
const EXTENSIONLESS_FILES =
  /^(dockerfile|makefile|license|licence|procfile|gemfile|rakefile|jenkinsfile|cmakelists\.txt)(\..+)?$/i;

/** Directory listings and repo roots should not become "Open file" cards. */
export function isBrowsableSourcePath(path: string): boolean {
  const trimmed = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!trimmed || trimmed === "." || trimmed === "/" ) return false;
  const base = trimmed.split("/").pop() || "";
  if (!base || base === "." || base === "..") return false;
  if (base.startsWith(".") && base.length > 1) return true;
  if (EXTENSIONLESS_FILES.test(base)) return true;
  return /\.[a-zA-Z0-9]{1,12}$/.test(base);
}

function shouldSkipGithubTool(name: string): boolean {
  return SKIP_GITHUB_TOOLS.test(name);
}

function acceptArtifact(artifact: GithubArtifact): boolean {
  if (artifact.kind !== "file") return true;
  return isBrowsableSourcePath(artifact.label);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown> | undefined, ...keys: string[]): string {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function githubArtifactFromPayload(
  id: string,
  payload: unknown,
  fallbackTitle?: string,
): GithubArtifact | undefined {
  const record = asRecord(payload);
  if (!record) return undefined;
  const path = stringField(record, "path");
  const owner = stringField(record, "owner");
  const repo = stringField(record, "repo", "repositoryName");
  const branch = stringField(record, "branch", "defaultBranch") || "main";
  const href =
    stringField(record, "html_url", "htmlUrl", "githubUrl", "url") ||
    (owner && repo && path ? githubBlobUrl(owner, repo, path, branch) : "") ||
    (owner && repo ? `https://github.com/${owner}/${repo}` : "");
  if (!href) return undefined;
  const kind: GithubArtifact["kind"] = path
    ? "file"
    : /\/pull\/\d+/i.test(href)
      ? "pr"
      : /\/issues\/\d+/i.test(href)
        ? "issue"
        : "repo";
  const label = path || stringField(record, "title", "fullName", "full_name") || fallbackTitle || href;
  return { id, label, href, kind };
}

export function githubArtifactsFromEvents(events: AgentToolEvent[] = []): GithubArtifact[] {
  const seen = new Set<string>();
  const artifacts: GithubArtifact[] = [];
  for (const event of events) {
    if (event.type === "error") continue;
    if (/^coding_session_/.test(event.type)) {
      const record = asRecord(event.payload);
      const href = stringField(record, "previewUrl");
      if (href && !seen.has(href)) {
        seen.add(href);
        artifacts.push({
          id: event.id,
          label: isStubPreviewUrl(href) ? "Stub preview (Azure not configured)" : "Preview",
          href,
          kind: "preview",
        });
      }
      continue;
    }
    if (!/^github_/.test(event.type)) continue;
    if (shouldSkipGithubTool(event.type)) continue;
    const artifact = githubArtifactFromPayload(event.id, event.payload, event.detail || event.title);
    if (!artifact || seen.has(artifact.href) || !acceptArtifact(artifact)) continue;
    seen.add(artifact.href);
    artifacts.push(artifact);
  }
  return artifacts;
}

export function githubArtifactsFromSteps(steps: TranscriptStep[] = []): GithubArtifact[] {
  const seen = new Set<string>();
  const artifacts: GithubArtifact[] = [];
  for (const step of steps) {
    let payload: unknown = step.event?.payload;
    if (!payload && step.result?.content) {
      try {
        payload = JSON.parse(step.result.content);
      } catch {
        payload = undefined;
      }
    }
    const args = (() => {
      try {
        return JSON.parse(step.call.arguments || "{}") as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    })();
    const merged = {
      ...(typeof payload === "object" && payload ? payload : {}),
      path: (payload as { path?: string } | undefined)?.path || args.path,
      owner: (payload as { owner?: string } | undefined)?.owner || args.owner,
      repo: (payload as { repo?: string } | undefined)?.repo || args.repo,
    };
    const previewUrl =
      stringField(asRecord(merged), "previewUrl") ||
      (typeof args.previewUrl === "string" ? args.previewUrl : "");
    if (previewUrl && !seen.has(previewUrl) && /^coding_session_/.test(step.call.name)) {
      seen.add(previewUrl);
      artifacts.push({
        id: step.call.id,
        label: isStubPreviewUrl(previewUrl) ? "Stub preview (Azure not configured)" : "Preview",
        href: previewUrl,
        kind: "preview",
      });
      continue;
    }
    if (shouldSkipGithubTool(step.call.name)) continue;
    const artifact = githubArtifactFromPayload(
      step.call.id,
      merged,
      typeof args.path === "string" ? args.path : step.call.name,
    );
    if (!artifact) {
      const ref = parseGithubRepoRef(typeof args.repoId === "string" ? args.repoId : "");
      if (ref && typeof args.path === "string" && isBrowsableSourcePath(args.path)) {
        const href = githubBlobUrl(ref.owner, ref.repo, args.path, typeof args.branch === "string" ? args.branch : "main");
        if (!seen.has(href)) {
          seen.add(href);
          artifacts.push({ id: step.call.id, label: args.path, href, kind: "file" });
        }
      }
      continue;
    }
    if (seen.has(artifact.href) || !acceptArtifact(artifact)) continue;
    seen.add(artifact.href);
    artifacts.push(artifact);
  }
  return artifacts;
}
