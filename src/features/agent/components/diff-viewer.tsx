"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DiffFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

export type CheckRun = {
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string;
};

function hunksFromPatch(patch?: string): Array<{ header: string; body: string; line: number }> {
  if (!patch) return [];
  const chunks = patch.split(/^@@/m).slice(1);
  return chunks.map((chunk) => {
    const [headerLine, ...rest] = chunk.split("\n");
    const header = `@@${headerLine ?? ""}`;
    const plus = header.match(/\+(\d+)/);
    return { header, body: rest.join("\n"), line: plus ? Number(plus[1]) : 1 };
  });
}

export function DiffViewer({
  files,
  checks,
  walkthrough,
  onComment,
  onMerge,
  merging,
}: {
  files: DiffFile[];
  checks?: CheckRun[];
  walkthrough?: string;
  onComment?: (file: string, line: number, body: string) => void;
  onMerge?: () => void;
  merging?: boolean;
}) {
  const [active, setActive] = useState(files[0]?.filename ?? "");
  const [comment, setComment] = useState("");
  const current = useMemo(() => files.find((file) => file.filename === active) ?? files[0], [files, active]);
  const hunks = hunksFromPatch(current?.patch);

  if (!files.length) {
    return <p className="text-xs text-muted-foreground px-1">No diff yet. Open a pull request or push the session branch.</p>;
  }

  return (
    <div className="space-y-3">
      {walkthrough ? (
        <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
          {walkthrough}
        </div>
      ) : null}
      {checks?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {checks.map((check) => (
            <span
              key={check.name}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                check.conclusion === "success"
                  ? "border-emerald-500/40 text-emerald-600"
                  : check.conclusion === "failure"
                    ? "border-destructive/40 text-destructive"
                    : "border-sidebar-border text-muted-foreground",
              )}
            >
              {check.name}: {check.conclusion || check.status}
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        {files.map((file) => (
          <button
            key={file.filename}
            type="button"
            onClick={() => setActive(file.filename)}
            className={cn(
              "rounded-md border px-2 py-1.5 text-left text-[11px]",
              file.filename === current?.filename
                ? "border-primary/40 bg-sidebar-accent text-foreground"
                : "border-sidebar-border text-muted-foreground hover:bg-sidebar-accent/40",
            )}
          >
            <span className="font-medium text-foreground">{file.filename}</span>
            <span className="ml-2 text-emerald-600">+{file.additions}</span>
            <span className="ml-1 text-destructive">-{file.deletions}</span>
          </button>
        ))}
      </div>
      {hunks.map((hunk, index) => (
        <div key={`${current?.filename}-${index}`} className="rounded-lg border border-sidebar-border bg-card overflow-hidden">
          <div className="px-2 py-1 text-[10px] font-mono text-muted-foreground bg-sidebar-accent/40">{hunk.header}</div>
          <pre className="px-2 py-2 text-[10px] font-mono whitespace-pre-wrap overflow-x-auto">{hunk.body}</pre>
          {onComment ? (
            <div className="border-t border-sidebar-border p-2 flex flex-col gap-1.5">
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder={`Comment on ${current?.filename}:${hunk.line}`}
                className="min-h-14 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!comment.trim()}
                onClick={() => {
                  onComment(current?.filename || "", hunk.line, comment.trim());
                  setComment("");
                }}
              >
                Send to agent
              </Button>
            </div>
          ) : null}
        </div>
      ))}
      {onMerge ? (
        <Button type="button" size="sm" onClick={onMerge} disabled={merging}>
          {merging ? "Merging…" : "Merge after Accept"}
        </Button>
      ) : null}
    </div>
  );
}
