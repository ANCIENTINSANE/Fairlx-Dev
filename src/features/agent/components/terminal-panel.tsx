"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, ChevronDown, ChevronRight, Loader2, Radio, SquareTerminal } from "lucide-react";

import { cn } from "@/lib/utils";

import { clockTime } from "../lib/agent-ui";
import type { TerminalEntry } from "../lib/run-live";
import { SidebarEmptyState } from "./workflow-sidebar-ui";

function elapsed(from: string, until?: string, now = Date.now()): string {
  const start = new Date(from).getTime();
  const end = until ? new Date(until).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function Prompt({ cwd }: { cwd?: string }) {
  return (
    <span className="select-none text-emerald-600 dark:text-emerald-400">
      <span className="text-sky-600 dark:text-sky-400">sandbox</span>
      <span className="text-zinc-500">:</span>
      <span className="text-violet-600 dark:text-violet-400">{cwd || "/workspace"}</span>
      <span className="text-zinc-500">$ </span>
    </span>
  );
}

function StatusDot({ status }: { status: TerminalEntry["status"] }) {
  if (status === "running") {
    return (
      <span className="relative flex size-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/60" />
        <span className="relative size-2 rounded-full bg-emerald-500" />
      </span>
    );
  }
  if (status === "failed") return <span className="size-2 rounded-full bg-rose-500" />;
  if (status === "recorded") return <span className="size-2 rounded-full border border-zinc-400" />;
  return <span className="size-2 rounded-full bg-zinc-400/80" />;
}

function TerminalCard({ entry, defaultOpen, now }: { entry: TerminalEntry; defaultOpen: boolean; now: number }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (entry.status === "running") setOpen(true);
  }, [entry.status]);
  const running = entry.status === "running";
  const time = elapsed(entry.startedAt, entry.endedAt, now);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={cn(
        "overflow-hidden rounded-xl border text-[11px] shadow-sm",
        running
          ? "border-emerald-500/40 bg-zinc-50 shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_8px_24px_-12px_rgba(16,185,129,0.45)] dark:bg-zinc-950"
          : entry.status === "failed"
            ? "border-rose-500/30 bg-zinc-50 dark:bg-zinc-950"
            : "border-amber-500/20 bg-zinc-50 dark:border-amber-500/15 dark:bg-zinc-950",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 border-b border-zinc-200 bg-zinc-100 px-3 py-1.5 text-left dark:border-white/10 dark:bg-zinc-900"
      >
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-rose-400/90" />
          <span className="size-2 rounded-full bg-amber-400/90" />
          <span className="size-2 rounded-full bg-emerald-400/90" />
        </span>
        {entry.kind === "dev_server" ? (
          <Radio className={cn("size-3", running ? "text-emerald-500" : "text-zinc-500")} />
        ) : (
          <SquareTerminal className="size-3 text-amber-600 dark:text-amber-300" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono font-medium text-zinc-700 dark:text-zinc-200">
          {entry.kind === "dev_server" ? `dev server · ${entry.command}` : entry.command}
        </span>
        <StatusDot status={entry.status} />
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
          {running ? (entry.kind === "dev_server" ? `up ${time}` : time) : typeof entry.exitCode === "number" ? `exit ${entry.exitCode}` : clockTime(entry.startedAt, true)}
        </span>
        {open ? <ChevronDown className="size-3 text-zinc-500" /> : <ChevronRight className="size-3 text-zinc-500" />}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <pre className="custom-scrollbar max-h-64 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-800 dark:text-zinc-100">
              <Prompt cwd={entry.cwd} />
              <span className="text-zinc-900 dark:text-zinc-50">{entry.command}</span>
              {"\n"}
              {entry.output ? <span className="text-emerald-700 dark:text-emerald-300/90">{entry.output}</span> : null}
              {entry.stderr ? (
                <>
                  {entry.output ? "\n" : ""}
                  <span className="text-rose-600 dark:text-rose-300">{entry.stderr}</span>
                </>
              ) : null}
              {running ? (
                <span className="inline-flex items-center gap-1.5 text-zinc-500">
                  {entry.output ? "\n" : ""}
                  <Loader2 className="size-3 animate-spin" />
                  {entry.kind === "dev_server" ? "serving — output streams to the sandbox log" : "running in Azure sandbox…"}
                  <span className="inline-block h-3 w-1.5 animate-pulse bg-zinc-500/70" />
                </span>
              ) : !entry.output && !entry.stderr ? (
                <span className="text-zinc-500">{entry.status === "recorded" ? "(recorded — no sandbox bound, not executed)" : "(no output)"}</span>
              ) : null}
            </pre>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

export function TerminalPanel({
  running,
  closed,
  hasSandbox,
}: {
  running: TerminalEntry[];
  closed: TerminalEntry[];
  hasSandbox: boolean;
}) {
  const [closedOpen, setClosedOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running.length) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running.length]);

  if (!running.length && !closed.length) {
    return (
      <SidebarEmptyState icon={SquareTerminal} tone="amber" title="No terminals yet">
        {hasSandbox
          ? "Commands the agent runs in the Azure sandbox show up here, newest on top."
          : "Start a coding session so commands run in Azure, not on the Fairlx host."}
      </SidebarEmptyState>
    );
  }

  const failed = closed.filter((entry) => entry.status === "failed").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          {running.length ? `${running.length} running` : "Idle"}
        </span>
        {running.length ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            live
          </span>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {running.map((entry) => (
          <TerminalCard key={entry.id} entry={entry} defaultOpen now={now} />
        ))}
      </AnimatePresence>

      {closed.length ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setClosedOpen((value) => !value)}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-sidebar-border bg-sidebar-accent/30 px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
          >
            <Archive className="size-3.5" />
            <span className="flex-1">
              <span className="font-medium text-foreground">{closed.length}</span> executed &amp; closed
              {failed ? <span className="text-rose-500"> · {failed} failed</span> : null}
              <span className="text-muted-foreground"> — click to {closedOpen ? "hide" : "open"}</span>
            </span>
            {closedOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          <AnimatePresence initial={false}>
            {closedOpen ? (
              <motion.div
                key="closed"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2 overflow-hidden"
              >
                {closed.map((entry) => (
                  <TerminalCard key={entry.id} entry={entry} defaultOpen={false} now={now} />
                ))}
              </motion.div>
            ) : (
              <ul className="space-y-0.5 px-1">
                {closed.slice(0, 4).map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2 truncate font-mono text-[10.5px] text-muted-foreground">
                    <StatusDot status={entry.status} />
                    <span className="truncate">{entry.command}</span>
                  </li>
                ))}
                {closed.length > 4 ? <li className="pl-4 text-[10px] text-muted-foreground">+{closed.length - 4} more</li> : null}
              </ul>
            )}
          </AnimatePresence>
        </div>
      ) : null}
    </div>
  );
}
