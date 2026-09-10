"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Pencil, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

import type { ChangedFile } from "../lib/run-live";
import { FileIcon } from "./file-icon";

type TreeNode = {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  file?: ChangedFile;
  /** Non-changed file known from a repo listing — rendered dimmed for context. */
  ghost?: boolean;
};

const RECENT_EDIT_MS = 25_000;

function buildTree(files: ChangedFile[], ghosts: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  const insert = (path: string, file?: ChangedFile, ghost?: boolean) => {
    const parts = path.split("/").filter(Boolean);
    let node = root;
    let acc = "";
    parts.forEach((part, index) => {
      acc = acc ? `${acc}/${part}` : part;
      let next = node.children.get(part);
      if (!next) {
        next = { name: part, path: acc, children: new Map() };
        node.children.set(part, next);
      }
      if (index === parts.length - 1) {
        if (file) {
          next.file = file;
          next.ghost = false;
        } else if (!next.file) {
          next.ghost = ghost;
        }
      }
      node = next;
    });
  };
  for (const file of files) insert(file.path, file);
  for (const ghost of ghosts) insert(ghost, undefined, true);
  return root;
}

/** Collapse single-child folder chains: src/features/agent → one row. */
function compact(node: TreeNode): TreeNode {
  const children = new Map<string, TreeNode>();
  for (const child of node.children.values()) {
    let current = compact(child);
    while (!current.file && current.ghost === undefined && current.children.size === 1) {
      const only = [...current.children.values()][0]!;
      if (only.file || only.ghost !== undefined) break;
      current = { ...only, name: `${current.name}/${only.name}` };
    }
    children.set(current.name, current);
  }
  return { ...node, children };
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    const aFolder = a.children.size > 0;
    const bFolder = b.children.size > 0;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function folderCount(node: TreeNode): number {
  let count = node.file ? 1 : 0;
  for (const child of node.children.values()) count += folderCount(child);
  return count;
}

function statusTone(status: ChangedFile["status"]) {
  if (status === "added") return "text-emerald-600 dark:text-emerald-400";
  if (status === "removed") return "text-rose-600 dark:text-rose-400";
  if (status === "renamed") return "text-violet-600 dark:text-violet-400";
  return "text-amber-600 dark:text-amber-400";
}

function statusGlyph(status: ChangedFile["status"]) {
  if (status === "added") return "A";
  if (status === "removed") return "D";
  if (status === "renamed") return "R";
  return "M";
}

/** A tiny 3D pencil that pops up and wiggles on freshly edited files. */
function EditToy() {
  return (
    <motion.span
      initial={{ scale: 0, rotate: -40, y: 6 }}
      animate={{ scale: 1, rotate: [0, -14, 10, -6, 0], y: [0, -3, 0] }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{ duration: 0.9, ease: "easeOut", repeat: Infinity, repeatDelay: 1.4 }}
      style={{ perspective: 60, transformStyle: "preserve-3d" }}
      className="relative inline-flex size-4 items-center justify-center"
      title="Just edited"
    >
      <motion.span
        className="absolute inset-0 rounded-full bg-amber-400/25"
        animate={{ scale: [1, 1.7], opacity: [0.7, 0] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
      />
      <Pencil className="relative size-3 text-amber-500 drop-shadow-[0_1px_0_rgba(0,0,0,0.25)]" />
    </motion.span>
  );
}

function FileRow({
  node,
  depth,
  now,
  active,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  now: number;
  active: boolean;
  onSelect?: (path: string) => void;
}) {
  const file = node.file;
  const fresh = Boolean(file?.editedAt && now - new Date(file.editedAt).getTime() < RECENT_EDIT_MS);
  return (
    <motion.button
      layout
      type="button"
      onClick={() => file && onSelect?.(file.path)}
      disabled={!file}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "group flex w-full items-center gap-1.5 rounded-md py-[3px] pr-1.5 text-left text-[11.5px] transition-colors",
        file ? "hover:bg-sidebar-accent/70" : "cursor-default opacity-45",
        active && "bg-emerald-500/10",
        fresh && "bg-amber-500/[0.08]",
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <FileIcon filename={node.name} className="size-5 rounded" iconClassName="size-3" />
      <span className={cn("min-w-0 flex-1 truncate", file ? "text-foreground/90" : "text-muted-foreground")}>{node.name}</span>
      <AnimatePresence>{fresh ? <EditToy /> : null}</AnimatePresence>
      {file ? (
        <>
          {file.additions || file.deletions ? (
            <span className="shrink-0 font-mono text-[10px] tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>{" "}
              <span className="text-rose-500">-{file.deletions}</span>
            </span>
          ) : null}
          <span className={cn("w-3 shrink-0 text-center font-mono text-[10px] font-bold", statusTone(file.status))}>
            {statusGlyph(file.status)}
          </span>
        </>
      ) : null}
    </motion.button>
  );
}

function FolderRow({
  node,
  depth,
  now,
  activePath,
  onSelect,
  defaultOpen,
}: {
  node: TreeNode;
  depth: number;
  now: number;
  activePath?: string | null;
  onSelect?: (path: string) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const children = sortNodes([...node.children.values()]);
  const count = folderCount(node);
  const freshInside = children.some(function hasFresh(child): boolean {
    if (child.file?.editedAt && now - new Date(child.file.editedAt).getTime() < RECENT_EDIT_MS) return true;
    return [...child.children.values()].some(hasFresh);
  });
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded-md py-[3px] pr-1.5 text-left text-[11.5px] text-foreground/80 transition-colors hover:bg-sidebar-accent/60"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {open ? <ChevronDown className="size-3 text-muted-foreground" /> : <ChevronRight className="size-3 text-muted-foreground" />}
        {open ? <FolderOpen className="size-3.5 text-sky-500" /> : <Folder className="size-3.5 text-sky-500" />}
        <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
        {!open && freshInside ? <Sparkles className="size-3 text-amber-500" /> : null}
        <span className="shrink-0 rounded-full bg-muted px-1.5 text-[9.5px] tabular-nums text-muted-foreground">{count}</span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            {children.map((child) =>
              child.children.size ? (
                <FolderRow key={child.path} node={child} depth={depth + 1} now={now} activePath={activePath} onSelect={onSelect} defaultOpen={depth < 2} />
              ) : (
                <FileRow key={child.path} node={child} depth={depth + 1} now={now} active={activePath === child.path} onSelect={onSelect} />
              ),
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function ChangesTree({
  files,
  knownPaths = [],
  activePath,
  onSelect,
  repoName,
}: {
  files: ChangedFile[];
  /** Other repo paths we know about (from listings) — shown dimmed for orientation. */
  knownPaths?: string[];
  activePath?: string | null;
  onSelect?: (path: string) => void;
  repoName?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const hasFresh = files.some((file) => file.editedAt && Date.now() - new Date(file.editedAt).getTime() < RECENT_EDIT_MS);
  useEffect(() => {
    if (!hasFresh) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasFresh]);

  const tree = useMemo(() => compact(buildTree(files, knownPaths.slice(0, 200))), [files, knownPaths]);
  const roots = sortNodes([...tree.children.values()]);
  const totals = files.reduce(
    (acc, file) => {
      acc.add += file.additions;
      acc.del += file.deletions;
      return acc;
    },
    { add: 0, del: 0 },
  );

  return (
    <div className="border-b border-sidebar-border">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-[10.5px] uppercase tracking-wider text-muted-foreground">
        <span className="font-semibold">{repoName || "Project"}</span>
        <span className="tabular-nums">
          {files.length} {files.length === 1 ? "file" : "files"}
        </span>
        {totals.add || totals.del ? (
          <span className="ml-auto font-mono text-[10px] normal-case tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">+{totals.add}</span>{" "}
            <span className="text-rose-500">-{totals.del}</span>
          </span>
        ) : (
          <span className="ml-auto text-[10px] normal-case">edited in sandbox</span>
        )}
      </div>
      <div className="custom-scrollbar max-h-64 overflow-y-auto px-1.5 pb-2">
        {roots.map((node) =>
          node.children.size ? (
            <FolderRow key={node.path} node={node} depth={0} now={now} activePath={activePath} onSelect={onSelect} defaultOpen />
          ) : (
            <FileRow key={node.path} node={node} depth={0} now={now} active={activePath === node.path} onSelect={onSelect} />
          ),
        )}
      </div>
    </div>
  );
}
