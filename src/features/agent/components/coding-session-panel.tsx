"use client";

import { Button } from "@/components/ui/button";
import type { CodingSession } from "../types";

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
          Delegate this work item to Fairlx Agent to clone in Azure, review diffs, and merge without a local checkout.
        </p>
        {onStart ? (
          <Button type="button" size="sm" variant="secondary" onClick={onStart}>
            Start session
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-3 space-y-1.5">
      <p className="text-xs font-medium text-foreground">Coding session · {session.status.replace(/_/g, " ")}</p>
      {session.headBranch ? (
        <p className="text-[11px] font-mono text-muted-foreground">{session.headBranch}</p>
      ) : null}
      {session.previewUrl ? (
        <a href={session.previewUrl} target="_blank" rel="noreferrer" className="block text-[11px] text-primary truncate">
          Preview {session.previewUrl}
        </a>
      ) : null}
      {session.prUrl ? (
        <a href={session.prUrl} target="_blank" rel="noreferrer" className="block text-[11px] text-primary truncate">
          Pull request {session.prNumber ? `#${session.prNumber}` : ""}
        </a>
      ) : null}
    </div>
  );
}
