"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, GitBranch } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  collapseUnmodified,
  fileExtBadge,
  isNewFileStatus,
  parseUnifiedPatch,
  type DiffLine,
} from "../lib/diff-patch";

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

function FileIconToggle({
  filename,
  open,
  onToggle,
}: {
  filename: string;
  open: boolean;
  onToggle: () => void;
}) {
  const badge = fileExtBadge(filename);
  return (
    <button
      type="button"
      title={open ? "Collapse file" : "Expand file"}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className="group/icon relative size-4 shrink-0 rounded-[3px]"
    >
      <span
        className={cn(
          "absolute inset-0 inline-flex items-center justify-center rounded-[3px] text-[8px] font-bold leading-none transition-opacity",
          badge.className,
          "group-hover/icon:opacity-0",
        )}
      >
        {badge.label}
      </span>
      <span className="absolute inset-0 flex items-center justify-center text-muted-foreground opacity-0 transition-opacity group-hover/icon:opacity-100">
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </span>
    </button>
  );
}

function UnmodifiedBar({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-center gap-1.5 bg-muted/40 py-1 text-[11px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
    >
      <ChevronDown className={cn("size-3 transition-transform", open ? "rotate-180" : "rotate-0")} />
      {count} unmodified {count === 1 ? "line" : "lines"}
      <ChevronDown className={cn("size-3 -scale-y-100 transition-transform", open ? "rotate-180" : "rotate-0")} />
    </button>
  );
}

function DiffLineRow({
  kind,
  text,
  line,
  selected,
  onSelect,
}: {
  kind: "context" | "add" | "del";
  text: string;
  line?: number;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <div
      role={onSelect ? "button" : undefined}
      onClick={onSelect}
      className={cn(
        "flex font-mono text-[11px] leading-[18px]",
        kind === "add" && "bg-emerald-500/15",
        kind === "del" && "bg-red-500/15",
        selected && "ring-1 ring-inset ring-primary/60",
        onSelect && "cursor-pointer hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "w-10 shrink-0 select-none border-r border-border/50 px-1.5 text-right tabular-nums text-muted-foreground/80",
          kind === "add" && "border-emerald-500/20 text-emerald-700 dark:text-emerald-400/80",
          kind === "del" && "border-red-500/20 text-red-700 dark:text-red-400/80",
        )}
      >
        {line ?? ""}
      </span>
      <span
        className={cn(
          "w-4 shrink-0 select-none text-center",
          kind === "add" && "text-emerald-600",
          kind === "del" && "text-red-500",
          kind === "context" && "text-transparent",
        )}
      >
        {kind === "add" ? "+" : kind === "del" ? "−" : "·"}
      </span>
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-1 text-foreground">{text || " "}</pre>
    </div>
  );
}

function FilePatch({
  file,
  onComment,
}: {
  file: DiffFile;
  onComment?: (file: string, line: number, body: string) => void;
}) {
  const [comment, setComment] = useState("");
  const [openGaps, setOpenGaps] = useState<Set<string>>(() => new Set());
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const lines = useMemo(() => parseUnifiedPatch(file.patch), [file.patch]);
  const blocks = useMemo(() => collapseUnmodified(lines), [lines]);
  const commentLine = selectedLine ?? lines.find((line: DiffLine) => line.kind === "add")?.newLine ?? 1;

  if (!file.patch) {
    return <p className="px-3 py-3 text-xs text-muted-foreground">No patch for this file.</p>;
  }

  return (
    <div className="min-w-0 border-t border-sidebar-border/70">
      {blocks.map((block) => {
        if (block.type === "gap") {
          const open = openGaps.has(block.id);
          return (
            <div key={block.id}>
              <UnmodifiedBar
                count={block.lines.length}
                open={open}
                onToggle={() =>
                  setOpenGaps((currentGaps) => {
                    const next = new Set(currentGaps);
                    if (next.has(block.id)) next.delete(block.id);
                    else next.add(block.id);
                    return next;
                  })
                }
              />
              {open
                ? block.lines.map((line, index) => (
                    <DiffLineRow key={`${block.id}-${index}`} kind="context" text={line.text} line={line.newLine} />
                  ))
                : null}
            </div>
          );
        }
        return (
          <div key={block.lines.map((line) => `${line.kind}:${line.oldLine}:${line.newLine}`).join("|")}>
            {block.lines.map((line, index) => (
              <DiffLineRow
                key={`${line.kind}-${line.oldLine ?? ""}-${line.newLine ?? ""}-${index}`}
                kind={line.kind}
                text={line.text}
                line={line.kind === "del" ? line.oldLine : line.newLine}
                selected={Boolean(onComment && (line.newLine ?? line.oldLine) === commentLine)}
                onSelect={
                  onComment
                    ? () => setSelectedLine(line.kind === "del" ? line.oldLine ?? 1 : line.newLine ?? 1)
                    : undefined
                }
              />
            ))}
          </div>
        );
      })}
      {onComment ? (
        <div className="border-t border-sidebar-border p-2">
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={`Comment on ${file.filename}:${commentLine} — resumes the bound Fairlx session`}
            className="min-h-12 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
          />
          <Button
            type="button"
            size="xs"
            variant="secondary"
            className="mt-1.5"
            disabled={!comment.trim()}
            onClick={() => {
              onComment(file.filename, commentLine, comment.trim());
              setComment("");
            }}
          >
            Send to Fairlx
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function DiffViewer({
  files,
  checks,
  walkthrough,
  branch,
  onComment,
  onMerge,
  merging,
  focusFile,
}: {
  files: DiffFile[];
  checks?: CheckRun[];
  walkthrough?: string;
  branch?: string;
  onComment?: (file: string, line: number, body: string) => void;
  onMerge?: () => void;
  merging?: boolean;
  /** Externally requested file (from the project tree): opened and scrolled into view when it changes. */
  focusFile?: string | null;
}) {
  const [openFiles, setOpenFiles] = useState<Set<string>>(() => new Set(files[0]?.filename ? [files[0].filename] : []));
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!focusFile) return;
    setOpenFiles((current) => (current.has(focusFile) ? current : new Set([...current, focusFile])));
    const id = window.requestAnimationFrame(() => {
      document.getElementById(`diff-file-${encodeURIComponent(focusFile)}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [focusFile]);

  const fileNames = files.map((file) => file.filename).join("\0");
  useEffect(() => {
    setOpenFiles((current) => {
      const names = fileNames ? fileNames.split("\0") : [];
      const known = new Set(names);
      const next = new Set([...current].filter((name) => known.has(name)));
      if (next.size === 0 && names[0]) next.add(names[0]);
      if (next.size === current.size && [...next].every((name) => current.has(name))) return current;
      return next;
    });
  }, [fileNames]);

  const totals = useMemo(
    () =>
      files.reduce(
        (acc, file) => {
          acc.additions += file.additions || 0;
          acc.deletions += file.deletions || 0;
          return acc;
        },
        { additions: 0, deletions: 0 },
      ),
    [files],
  );

  const toggleFile = (filename: string) => {
    setOpenFiles((current) => {
      const next = new Set(current);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const openFile = (filename: string) => {
    setOpenFiles((current) => {
      if (current.has(filename)) return current;
      const next = new Set(current);
      next.add(filename);
      return next;
    });
  };

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(path);
      window.setTimeout(() => setCopied((value) => (value === path ? null : value)), 1200);
    } catch {
      toast.error("Couldn't copy the path.");
    }
  };

  if (!files.length) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">
        No diff yet. Open a pull request or push the session branch.
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-emerald-500/15 bg-emerald-500/[0.04] px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
            <span className="font-semibold text-foreground">Uncommitted</span>
            <span className="tabular-nums font-medium text-emerald-600 dark:text-emerald-400">+{totals.additions}</span>
            <span className="tabular-nums font-medium text-red-500">-{totals.deletions}</span>
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
              <GitBranch className="size-3" />
              {branch || "main"}
            </span>
          </div>
          {walkthrough ? (
            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{walkthrough}</p>
          ) : null}
        </div>
        {onMerge ? (
          <Button type="button" size="xs" onClick={onMerge} disabled={merging} className="shrink-0">
            {merging ? "Merging…" : "Commit & Push"}
          </Button>
        ) : null}
      </div>

      {checks?.length ? (
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-sidebar-border px-3 py-1.5">
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

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        {files.map((file) => {
          const open = openFiles.has(file.filename);
          const isNew = isNewFileStatus(file.status);
          return (
            <div key={file.filename} id={`diff-file-${encodeURIComponent(file.filename)}`} className="border-b border-sidebar-border">
              <div
                className={cn(
                  "group/file flex items-center gap-2 px-3 py-1.5 text-[12px]",
                  open ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
                )}
              >
                <FileIconToggle filename={file.filename} open={open} onToggle={() => toggleFile(file.filename)} />
                <button
                  type="button"
                  onClick={() => openFile(file.filename)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-foreground/90">{file.filename}</span>
                  <span className="shrink-0 tabular-nums text-[11px] text-emerald-600">+{file.additions}</span>
                  <span className="shrink-0 tabular-nums text-[11px] text-red-500">-{file.deletions}</span>
                  {isNew ? <span className="shrink-0 text-[11px] font-medium text-emerald-500">New</span> : null}
                </button>
                <button
                  type="button"
                  title="Copy path"
                  onClick={() => copyPath(file.filename)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover/file:opacity-100"
                >
                  {copied === file.filename ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                </button>
              </div>
              {open ? <FilePatch file={file} onComment={onComment} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
