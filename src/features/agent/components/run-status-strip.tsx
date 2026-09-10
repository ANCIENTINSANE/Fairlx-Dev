"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bot, Box, Cpu, FileDiff, Loader2, Pin, SquareTerminal, Wand2 } from "lucide-react";

import { cn } from "@/lib/utils";

import type { AgentRun, AgentSessionMode, CodingSession } from "../types";
import type { RouteDecision } from "../lib/fairlx-router";
import { ROUTER_TASK_LABEL } from "../lib/fairlx-router";
import { sessionModeTagFromContent } from "../lib/mode-router";
import type { TerminalEntry } from "../lib/run-live";
import { describeSandboxPhases, formatEta } from "../lib/sandbox-phases";
import { AGENT_SESSION_MODES } from "../lib/session-context";
import type { WorkflowSidebarTab } from "../lib/sidebar-theme";

function currentTurnMode(run: AgentRun, fallback?: AgentSessionMode): { mode: AgentSessionMode; auto: boolean } | null {
  for (let i = run.messages.length - 1; i >= 0; i -= 1) {
    const message = run.messages[i]!;
    if (message.role !== "user") continue;
    const resolved = sessionModeTagFromContent(message.content);
    if (resolved) return resolved;
    break;
  }
  return fallback ? { mode: fallback, auto: false } : null;
}

function Chip({
  icon: Icon,
  children,
  onClick,
  tone = "neutral",
  title,
  pulse,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "neutral" | "live" | "warn" | "violet" | "cyan" | "emerald";
  title?: string;
  pulse?: boolean;
}) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[10.5px] font-medium tabular-nums transition-colors",
        tone === "neutral" && "border-border/70 bg-background/80 text-muted-foreground",
        tone === "live" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
        tone === "violet" && "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
        tone === "cyan" && "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
        tone === "emerald" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        onClick && "hover:bg-muted/70 cursor-pointer",
      )}
    >
      {pulse ? (
        <span className="relative flex size-1.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-60" />
          <span className="relative size-1.5 rounded-full bg-current" />
        </span>
      ) : (
        <Icon className="size-3" />
      )}
      {children}
    </Comp>
  );
}

export function RunStatusStrip({
  run,
  sessionMode,
  route,
  crewLive,
  terminals,
  filesChanged,
  session,
  thought,
  onTab,
}: {
  run: AgentRun;
  sessionMode?: AgentSessionMode;
  route: RouteDecision | null;
  crewLive: number;
  terminals: { running: TerminalEntry[]; closed: TerminalEntry[] };
  filesChanged: number;
  session?: CodingSession | null;
  thought?: { title: string; detail?: string } | null;
  onTab: (tab: WorkflowSidebarTab) => void;
}) {
  const running = run.status === "running";
  const turnMode = currentTurnMode(run, sessionMode);
  const modeMeta = turnMode ? AGENT_SESSION_MODES.find((item) => item.id === turnMode.mode) : undefined;
  const phases = describeSandboxPhases(session);
  const showSandbox = Boolean(session);
  const showStrip = running || terminals.running.length > 0 || filesChanged > 0 || showSandbox || Boolean(route);
  if (!showStrip) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="pointer-events-auto mb-2 rounded-2xl border border-border/60 bg-card/85 px-2.5 py-1.5 shadow-[0_8px_30px_-18px_rgba(0,0,0,0.5)] backdrop-blur"
    >
      <div className="custom-scrollbar flex items-center gap-1.5 overflow-x-auto">
        {turnMode && modeMeta ? (
          <Chip icon={Wand2} tone="violet" title={turnMode.auto ? "Fairlx auto-picked this mode from your message" : "Session mode"}>
            {turnMode.auto ? "auto → " : ""}
            {modeMeta.label}
          </Chip>
        ) : null}
        {route ? (
          <Chip
            icon={route.pinned ? Pin : Cpu}
            tone="neutral"
            title={route.reason}
          >
            {route.displayName}
            <span className="opacity-60">· {route.pinned ? "pinned" : ROUTER_TASK_LABEL[route.task]}</span>
          </Chip>
        ) : null}
        {crewLive > 0 ? (
          <Chip icon={Bot} tone="live" pulse onClick={() => onTab("context")} title="Open crew">
            {crewLive} {crewLive === 1 ? "agent" : "agents"} working
          </Chip>
        ) : null}
        {terminals.running.length ? (
          <Chip icon={SquareTerminal} tone="warn" pulse onClick={() => onTab("terminal")} title="Open terminals">
            {terminals.running.length} {terminals.running.length === 1 ? "terminal" : "terminals"} running
          </Chip>
        ) : terminals.closed.length ? (
          <Chip icon={SquareTerminal} onClick={() => onTab("terminal")} title="Open terminals">
            {terminals.closed.length} closed
          </Chip>
        ) : null}
        {filesChanged ? (
          <Chip icon={FileDiff} tone="emerald" onClick={() => onTab("changes")} title="Open changes">
            {filesChanged} {filesChanged === 1 ? "file" : "files"} changed
          </Chip>
        ) : null}
        {showSandbox ? (
          <Chip
            icon={Box}
            tone={phases.live ? "cyan" : phases.failed || phases.destroyed || phases.stuck ? "warn" : "neutral"}
            pulse={Boolean(session && !phases.live && !phases.failed && !phases.stuck && !phases.paused && !phases.destroyed)}
            onClick={() => onTab("preview")}
            title="Open preview"
          >
            {phases.live
              ? "preview live"
              : phases.paused
                ? "sandbox paused"
                : phases.destroyed
                  ? "sandbox gone"
                  : phases.failed
                    ? "sandbox failed"
                    : phases.stuck
                      ? "sandbox stuck · reboot"
                      : `${phases.headline.toLowerCase()}${phases.etaSeconds ? ` · ${formatEta(phases.etaSeconds)}` : ""}`}
          </Chip>
        ) : null}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {running && thought ? (
          <motion.p
            key={thought.title}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="mt-1 flex items-center gap-1.5 truncate px-0.5 text-[10.5px] italic text-muted-foreground"
          >
            <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
            <span className="truncate">{thought.title}{thought.detail ? ` — ${thought.detail.slice(0, 120)}` : ""}</span>
          </motion.p>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

/** Small pill for the chat toolbar: current sandbox state, click → Preview tab. */
export function SandboxPill({ session, onClick }: { session?: CodingSession | null; onClick: () => void }) {
  if (!session) return null;
  const phases = describeSandboxPhases(session);
  const building = !phases.live && !phases.failed && !phases.stuck && !phases.paused && !phases.destroyed;
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open sandbox preview"
      className={cn(
        "hidden items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors md:inline-flex",
        phases.live
          ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/15 dark:text-cyan-300"
          : phases.failed || phases.destroyed || phases.stuck
            ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
            : phases.paused
              ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
              : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
      )}
    >
      {building ? <Loader2 className="size-3 animate-spin" /> : <Box className="size-3" />}
      {phases.live
        ? "Preview live"
        : phases.paused
          ? "Sandbox paused"
          : phases.destroyed
            ? "Sandbox destroyed"
            : phases.failed
              ? "Sandbox failed"
              : phases.stuck
                ? "Sandbox stuck"
                : `${phases.headline}${phases.etaSeconds ? ` · ${formatEta(phases.etaSeconds)}` : ""}`}
    </button>
  );
}
