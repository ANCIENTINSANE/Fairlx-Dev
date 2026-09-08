"use client";

import { Button } from "@/components/ui/button";
import type { CodingSession } from "../types";
import { describeCodingPreview } from "../lib/sandbox-preview";

export function CodingSessionPanel({
  session,
  onStart,
}: {
  session?: CodingSession | null;
  onStart?: () => void;
}) {
  if (!session) {
    return (
      <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-3 space-y-2">
        <p className="text-xs font-medium text-foreground">Coding session</p>
        <p className="text-[11px] text-muted-foreground">
          Delegate this work item to Fairlx Agent to clone in Azure, start the app, review diffs, and merge without a local checkout.
        </p>
        {onStart ? (
          <Button type="button" size="sm" variant="secondary" onClick={onStart}>
            Start session
          </Button>
        ) : null}
      </div>
    );
  }

  const preview = describeCodingPreview({
    previewUrl: session.previewUrl,
    status: session.status,
    sandboxId: session.sandboxId,
    driver: session.driver,
    previewLive: session.previewLive,
  });
  const phase =
    preview.live
      ? "preview-ready"
      : session.status === "preparing" || session.status === "queued" || preview.preparing
        ? "preparing"
        : session.status.replace(/_/g, " ");

  return (
    <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-3 space-y-1.5">
      <p className="text-xs font-medium text-foreground">
        Coding session · {phase}
        {preview.driver !== "none" ? ` · ${preview.driver}` : ""}
      </p>
      {session.headBranch ? (
        <p className="text-[11px] font-mono text-muted-foreground">{session.headBranch}</p>
      ) : null}
      {session.codingAgent ? (
        <p className="text-[11px] text-muted-foreground">
          Coder: {session.codingAgent === "claude_code" ? "Claude Code" : session.codingAgent === "codex" ? "Codex" : "Fairlx specialists (fallback)"}
        </p>
      ) : null}
      {session.codingAgentReason && session.codingAgent === "specialists" ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-300">{session.codingAgentReason}</p>
      ) : null}
      {preview.stub ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-300">
          Stub preview — Azure sandbox credentials are not set. This is not a live app.
        </p>
      ) : null}
      {preview.live && session.previewUrl ? (
        <a href={session.previewUrl} target="_blank" rel="noreferrer" className="block text-[11px] text-primary truncate">
          Live preview {session.previewUrl}
        </a>
      ) : null}
      {preview.preparing ? (
        <p className="text-[11px] text-muted-foreground">Preparing sandbox: clone, install, start, health-check…</p>
      ) : null}
      {!preview.live && !preview.stub && !preview.preparing ? (
        <p className="text-[11px] text-muted-foreground">Preview not live.</p>
      ) : null}
      {session.prUrl ? (
        <a href={session.prUrl} target="_blank" rel="noreferrer" className="block text-[11px] text-primary truncate">
          Pull request {session.prNumber ? `#${session.prNumber}` : ""}
        </a>
      ) : null}
    </div>
  );
}
