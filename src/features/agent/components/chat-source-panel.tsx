"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronDown, ExternalLink, GitPullRequest, Globe, type LucideIcon } from "lucide-react";
import { FaGithub } from "react-icons/fa6";

import { isStubPreviewUrl, repairAzurePreviewUrl, type AzurePreviewCanonical } from "../lib/sandbox-preview";
import type { GithubArtifact } from "../lib/github-artifacts";
import { FileIcon } from "./file-icon";

function splitLabel(label: string): { file: string; dir: string } {
  const normalized = label.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  const file = parts.pop() || normalized;
  return { file, dir: parts.join("/") };
}

function kindMeta(artifact: GithubArtifact): { label: string; icon: LucideIcon } {
  if (artifact.kind === "pr") return { label: "Pull request", icon: GitPullRequest };
  if (artifact.kind === "issue") return { label: "Issue", icon: GitPullRequest };
  if (artifact.kind === "preview") {
    return {
      label: isStubPreviewUrl(artifact.href) ? "Stub preview" : "Live preview",
      icon: Globe,
    };
  }
  return { label: "Repository", icon: ExternalLink };
}

export function ChatSourcePanel({
  artifacts,
  previewCanonical,
}: {
  artifacts: GithubArtifact[];
  previewCanonical?: AzurePreviewCanonical;
}) {
  const files = artifacts.filter((item) => item.kind === "file");
  const others = artifacts.filter((item) => item.kind !== "file");
  const [expanded, setExpanded] = useState(files.length <= 10);
  if (!files.length && !others.length) return null;
  const visibleFiles = expanded ? files : files.slice(0, 8);
  const hidden = files.length - visibleFiles.length;

  return (
    <div className="mt-3 first:mt-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {others.length ? (
        <div className="flex flex-wrap gap-1.5 border-b border-border bg-muted/30 px-3 py-2">
          {others.map((artifact) => {
            const meta = kindMeta(artifact);
            const Icon = meta.icon;
            const href =
              artifact.kind === "preview"
                ? repairAzurePreviewUrl(artifact.href, previewCanonical)
                : artifact.href;
            return (
              <a
                key={artifact.id}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={meta.label}
                className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
              >
                <Icon className="size-3 shrink-0" />
                <span className="truncate">{artifact.label}</span>
                <ArrowUpRight className="size-3 shrink-0 opacity-70" />
              </a>
            );
          })}
        </div>
      ) : null}

      {files.length ? (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <FaGithub className="size-4 shrink-0 text-foreground" />
              <span className="text-[11px] font-semibold text-foreground">
                {files.length} {files.length === 1 ? "file" : "files"} on GitHub
              </span>
            </div>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2">
            {visibleFiles.map((artifact) => {
              const { file, dir } = splitLabel(artifact.label);
              return (
                <li
                  key={artifact.id}
                  className="min-w-0 border-t border-border/70 first:border-t-0 sm:[&:nth-child(2)]:border-t-0"
                >
                  <a
                    href={artifact.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={artifact.label}
                    className="group flex min-w-0 items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors"
                  >
                    <FileIcon filename={file} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-foreground group-hover:text-blue-500 dark:group-hover:text-blue-400 group-hover:underline">
                        {file}
                      </span>
                      {dir ? (
                        <span className="block truncate text-[10px] text-muted-foreground">{dir}</span>
                      ) : null}
                    </span>
                    <ArrowUpRight className="size-3 shrink-0 text-muted-foreground group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors" />
                  </a>
                </li>
              );
            })}
          </ul>
          {hidden > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex w-full items-center justify-center gap-1.5 border-t border-border bg-muted/20 px-3 py-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            >
              Show {hidden} more
              <ChevronDown className="size-3" />
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
