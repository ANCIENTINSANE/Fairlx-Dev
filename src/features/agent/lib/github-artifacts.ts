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
    const artifact = githubArtifactFromPayload(event.id, event.payload, event.detail || event.title);
    if (!artifact || seen.has(artifact.href)) continue;
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
    const artifact = githubArtifactFromPayload(
      step.call.id,
      merged,
      typeof args.path === "string" ? args.path : step.call.name,
    );
    if (!artifact) {
      const ref = parseGithubRepoRef(typeof args.repoId === "string" ? args.repoId : "");
      if (ref && typeof args.path === "string") {
        const href = githubBlobUrl(ref.owner, ref.repo, args.path, typeof args.branch === "string" ? args.branch : "main");
        if (!seen.has(href)) {
          seen.add(href);
          artifacts.push({ id: step.call.id, label: args.path, href, kind: "file" });
        }
      }
      continue;
    }
    if (seen.has(artifact.href)) continue;
    seen.add(artifact.href);
    artifacts.push(artifact);
  }
  return artifacts;
}
