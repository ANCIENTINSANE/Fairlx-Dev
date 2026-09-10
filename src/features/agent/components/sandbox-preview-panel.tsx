"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Box,
  Check,
  Copy,
  Download,
  ExternalLink,
  GitBranch,
  Link2,
  Loader2,
  PauseCircle,
  Play,
  Power,
  RotateCcw,
  Rocket,
  Server,
  Smartphone,
  Monitor,
  Timer,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CodingSession } from "../types";
import { describeCodingPreview } from "../lib/sandbox-preview";
import { describeSandboxPhases, formatEta, type SandboxPhase, type SandboxPhaseId } from "../lib/sandbox-phases";
import { describeSandboxLifecycle, formatIdleCountdown } from "../lib/sandbox-lifecycle-view";
import { AccentCard, StatusPill } from "./workflow-sidebar-ui";
import { SessionArtifacts } from "./session-artifacts";

const PHASE_ICONS: Record<SandboxPhaseId, LucideIcon> = {
  create: Box,
  clone: GitBranch,
  install: Download,
  start: Rocket,
  live: Link2,
};

/** Re-render once a second while something is in flight so ETAs and countdowns tick. */
function useTicker(active: boolean, intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

/** A tiny CSS-3D cube: the "sandbox" being assembled. Spins while preparing, settles when live. */
function SandboxCube({ spinning, tone }: { spinning: boolean; tone: "cyan" | "amber" | "rose" | "zinc" }) {
  const face =
    tone === "cyan"
      ? "border-cyan-400/60 bg-cyan-400/20"
      : tone === "amber"
        ? "border-amber-400/60 bg-amber-400/20"
        : tone === "rose"
          ? "border-rose-400/60 bg-rose-400/20"
          : "border-zinc-400/50 bg-zinc-400/15";
  const size = 26;
  const half = size / 2;
  const faces: Array<{ key: string; transform: string }> = [
    { key: "front", transform: `translateZ(${half}px)` },
    { key: "back", transform: `rotateY(180deg) translateZ(${half}px)` },
    { key: "right", transform: `rotateY(90deg) translateZ(${half}px)` },
    { key: "left", transform: `rotateY(-90deg) translateZ(${half}px)` },
    { key: "top", transform: `rotateX(90deg) translateZ(${half}px)` },
    { key: "bottom", transform: `rotateX(-90deg) translateZ(${half}px)` },
  ];
  return (
    <div className="flex size-10 shrink-0 items-center justify-center" style={{ perspective: 120 }}>
      <motion.div
        className="relative"
        style={{ width: size, height: size, transformStyle: "preserve-3d" }}
        animate={spinning ? { rotateX: [-20, -20], rotateY: [0, 360] } : { rotateX: -22, rotateY: 38 }}
        transition={spinning ? { duration: 3.2, repeat: Infinity, ease: "linear" } : { duration: 0.8, ease: "easeOut" }}
      >
        {faces.map((item) => (
          <span
            key={item.key}
            className={cn("absolute inset-0 rounded-[3px] border backdrop-blur-[1px]", face)}
            style={{ transform: item.transform }}
          />
        ))}
      </motion.div>
    </div>
  );
}

function PhaseRow({ phase, isLast }: { phase: SandboxPhase; isLast: boolean }) {
  const Icon = PHASE_ICONS[phase.id];
  const active = phase.status === "active";
  const done = phase.status === "done";
  const failed = phase.status === "failed";
  const skipped = phase.status === "skipped";
  return (
    <li className="relative flex gap-2.5">
      {!isLast ? (
        <span
          className={cn(
            "absolute left-[11px] top-6 h-[calc(100%-0.5rem)] w-px",
            done ? "bg-cyan-500/50" : "bg-border",
          )}
        />
      ) : null}
      <span
        className={cn(
          "relative z-10 mt-0.5 flex size-[23px] shrink-0 items-center justify-center rounded-full border text-[10px]",
          done && "border-cyan-500/40 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
          active && "border-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-300",
          failed && "border-rose-500/50 bg-rose-500/15 text-rose-700 dark:text-rose-300",
          (phase.status === "pending" || skipped) && "border-border bg-muted/40 text-muted-foreground",
        )}
      >
        {done ? (
          <Check className="size-3" />
        ) : failed ? (
          <X className="size-3" />
        ) : active ? (
          <>
            <span className="absolute inset-0 animate-ping rounded-full bg-sky-400/30" />
            <Icon className="relative size-3" />
          </>
        ) : (
          <Icon className="size-3" />
        )}
      </span>
      <div className="min-w-0 flex-1 pb-2.5">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-[11.5px] font-medium",
              active ? "text-foreground" : done ? "text-foreground/85" : failed ? "text-rose-700 dark:text-rose-300" : "text-muted-foreground",
            )}
          >
            {phase.label}
          </span>
          {active ? <Loader2 className="size-3 animate-spin text-sky-500" /> : null}
          {phase.detail && (done || failed) ? (
            <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">{phase.detail}</span>
          ) : null}
        </div>
        <p className={cn("text-[10.5px] leading-4", failed ? "text-rose-700/90 dark:text-rose-300/90" : "text-muted-foreground")}>
          {failed && phase.detail ? phase.detail : phase.hint}
        </p>
      </div>
    </li>
  );
}

function BrowserChrome({
  url,
  viewport,
  onViewport,
  children,
}: {
  url: string;
  viewport: "desktop" | "phone";
  onViewport: (next: "desktop" | "phone") => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-cyan-500/25 bg-zinc-50 dark:bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-100 px-2.5 py-1.5 dark:border-white/10 dark:bg-zinc-900">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-rose-400/90" />
          <span className="size-2 rounded-full bg-amber-400/90" />
          <span className="size-2 rounded-full bg-emerald-400/90" />
        </span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open preview in a new tab"
          className="min-w-0 flex-1 truncate rounded-md bg-white px-2 py-0.5 font-mono text-[10px] text-zinc-600 hover:text-zinc-900 hover:underline dark:bg-zinc-800 dark:text-zinc-300 dark:hover:text-white"
        >
          {url}
        </a>
        <div className="flex shrink-0 rounded-md border border-zinc-200 bg-white p-0.5 dark:border-white/10 dark:bg-zinc-800">
          <button
            type="button"
            title="Desktop preview"
            onClick={() => onViewport("desktop")}
            className={cn(
              "rounded px-1.5 py-0.5",
              viewport === "desktop" ? "bg-cyan-500/15 text-cyan-800 dark:text-cyan-200" : "text-muted-foreground",
            )}
          >
            <Monitor className="size-3" />
          </button>
          <button
            type="button"
            title="Phone preview (~390px) — hamburger / responsive"
            onClick={() => onViewport("phone")}
            className={cn(
              "rounded px-1.5 py-0.5",
              viewport === "phone" ? "bg-cyan-500/15 text-cyan-800 dark:text-cyan-200" : "text-muted-foreground",
            )}
          >
            <Smartphone className="size-3" />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Preview link copied. Anyone with the link can open it while the sandbox runs.");
  } catch {
    /* ignore */
  }
}

function lastSessionImplementAt(session?: CodingSession | null): string {
  const events = session?.events ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === "implement") return events[index]!.createdAt;
  }
  return session?.updatedAt || "";
}

function previewFrameSrc(url: string, stamp: string): string {
  if (!stamp) return url;
  try {
    const next = new URL(url);
    next.searchParams.set("fairlx_r", stamp.replace(/[^\d]/g, "").slice(-14) || "1");
    return next.toString();
  } catch {
    return url;
  }
}

export function SandboxPreviewPanel({
  session,
  project,
  repo,
  githubUrl,
  onStart,
  startPending,
  onRestart,
  restartPending,
}: {
  session?: CodingSession | null;
  project?: { id: string; name: string; workspaceId: string };
  repo?: { owner?: string; repositoryName?: string; branch?: string } | null;
  githubUrl?: string;
  onStart?: () => void;
  startPending?: boolean;
  onRestart?: () => void;
  restartPending?: boolean;
}) {
  const now = useTicker(Boolean(session));
  const [viewport, setViewport] = useState<"desktop" | "phone">("desktop");
  const phases = describeSandboxPhases(session, now);
  const lifecycle = describeSandboxLifecycle(session, now);
  const preview = describeCodingPreview({
    previewUrl: session?.previewUrl,
    status: session?.status,
    sandboxId: session?.sandboxId,
    driver: session?.driver,
    previewLive: session?.previewLive,
  });
  const implementStamp = lastSessionImplementAt(session);
  const frameSrc = preview.url ? previewFrameSrc(preview.url, implementStamp) : "";
  const building = Boolean(session && !phases.live && !phases.failed && !phases.stuck && !phases.paused && !phases.destroyed);

  if (!session) {
    return (
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-sky-500/5 to-transparent p-4">
          <div className="flex items-start gap-3">
            <SandboxCube spinning={false} tone="cyan" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-foreground">No sandbox running</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {repo
                  ? `Fairlx can pull ${repo.owner}/${repo.repositoryName} (${repo.branch || "main"}) into an Azure sandbox, install, start the app and hand you a shareable link.`
                  : project
                    ? "Connect GitHub to this project so Fairlx can clone the code into a sandbox."
                    : "Pick a project first, then Fairlx can run its code in a sandbox."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {repo && onStart ? (
                  <Button type="button" size="sm" disabled={startPending} onClick={onStart} className="gap-1.5">
                    {startPending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                    Run sandbox from Git
                  </Button>
                ) : project && !repo ? (
                  <Button type="button" size="sm" variant="secondary" asChild>
                    <Link href={`/workspaces/${project.workspaceId}/projects/${project.id}/github`}>
                      <GitBranch className="size-3.5" /> Connect GitHub
                    </Link>
                  </Button>
                ) : null}
                <span className="text-[10px] text-muted-foreground">
                  One sandbox per person per project · pauses after 15 min idle
                </span>
              </div>
            </div>
          </div>
        </div>
        {githubUrl ? (
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-300"
          >
            <span className="inline-flex items-center gap-2">
              <GitBranch className="size-3.5" />
              Open Repository
            </span>
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>
    );
  }

  const tone = phases.failed || phases.destroyed || phases.stuck ? "rose" : phases.paused ? "amber" : phases.live ? "cyan" : "sky";
  const cubeTone = phases.failed || phases.destroyed || phases.stuck ? "rose" : phases.paused ? "amber" : phases.live ? "cyan" : "zinc";
  const eta = building ? formatEta(phases.etaSeconds) : "";
  const lastError = [...(session.events ?? [])].reverse().find((event) => (event.type === "error" || event.type === "preview") && event.detail)?.detail;
  const healthLog = [...(session.events ?? [])]
    .reverse()
    .find((event) => event.type === "dev_server" || event.type === "preview")?.detail;
  const showLifecycle = phases.paused || phases.destroyed;
  const canReboot = Boolean(onRestart) && !phases.live;

  return (
    <div className="space-y-3">
      <AccentCard tone={tone}>
        <div className="space-y-3 p-3">
          <div className="flex items-start gap-2.5">
            <SandboxCube spinning={building} tone={cubeTone} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[12.5px] font-semibold text-foreground">{phases.headline}</p>
                <StatusPill
                  kind={
                    phases.live
                      ? "live"
                      : phases.failed || phases.destroyed || phases.stuck
                        ? "danger"
                        : phases.paused
                          ? "warn"
                          : "info"
                  }
                >
                  {phases.live
                    ? "live"
                    : phases.destroyed
                      ? "destroyed"
                      : phases.paused
                        ? "paused"
                        : phases.failed
                          ? "failed"
                          : phases.stuck
                            ? "stuck"
                            : preview.stub
                              ? "stub"
                              : "building"}
                </StatusPill>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {preview.driver !== "none" ? `${preview.driver} · ` : ""}
                {session.headBranch ? <span className="font-mono">{session.headBranch}</span> : session.status.replace(/_/g, " ")}
                {session.codingAgent
                  ? ` · ${session.codingAgent === "claude_code" ? "Claude Code" : session.codingAgent === "codex" ? "Codex" : "Fairlx specialists"}`
                  : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {building && eta ? (
                <div className="rounded-lg bg-sky-500/10 px-2 py-1 text-right">
                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                    <Timer className="size-3" /> ETA
                  </p>
                  <p className="font-mono text-[12px] font-semibold tabular-nums text-foreground">{eta}</p>
                </div>
              ) : null}
              {canReboot ? (
                <Button
                  type="button"
                  size="xs"
                  variant={phases.stuck || phases.failed || phases.paused || phases.destroyed ? "primary" : "secondary"}
                  disabled={restartPending}
                  onClick={onRestart}
                  className="gap-1"
                  title="Destroy this Azure VM and create a fresh sandbox from Git"
                >
                  {restartPending ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                  Reboot
                </Button>
              ) : null}
            </div>
          </div>

          {/* Progress bar */}
          {building ? (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className={cn(
                    "h-full rounded-full",
                    phases.failed
                      ? "bg-rose-500"
                      : phases.live
                        ? "bg-gradient-to-r from-cyan-500 to-emerald-500"
                        : "bg-gradient-to-r from-sky-500 via-cyan-400 to-sky-500 bg-[length:200%_100%]",
                  )}
                  initial={false}
                  animate={{
                    width: `${phases.percent}%`,
                    ...(phases.live || phases.failed ? {} : { backgroundPositionX: ["0%", "100%"] }),
                  }}
                  transition={{
                    width: { duration: 0.6, ease: "easeOut" },
                    backgroundPositionX: { duration: 1.6, repeat: Infinity, ease: "linear" },
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
                <span>{phases.percent}%</span>
                {phases.live && lifecycle.nextTransition ? (
                  <span className="inline-flex items-center gap-1">
                    <PauseCircle className="size-3" />
                    pauses after 15 min idle · {formatIdleCountdown(lifecycle.nextTransitionInMs)}
                  </span>
                ) : !phases.live && !phases.failed && !phases.stuck ? (
                  <span>{phases.current === "live" ? "waiting for the health check" : "building in Azure"}</span>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Phase stepper (collapsed once live) */}
          <AnimatePresence initial={false}>
            {!phases.live || phases.failed ? (
              <motion.ol
                key="phases"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden pt-1"
              >
                {phases.phases.map((phase, index) => (
                  <PhaseRow key={phase.id} phase={phase} isLast={index === phases.phases.length - 1} />
                ))}
              </motion.ol>
            ) : null}
          </AnimatePresence>

          {/* Early link — only while it is actually still preparing */}
          {building && phases.reservedUrl ? (
            <div className="flex items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/[0.07] px-2.5 py-1.5 text-[11px] text-sky-800 dark:text-sky-200">
              <Link2 className="size-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Link is preparing{eta ? ` · ${eta}` : ""}</p>
                <p className="truncate font-mono text-[10px] opacity-80">{phases.reservedUrl}</p>
              </div>
              <Button type="button" size="xs" variant="ghost" onClick={() => void copyLink(phases.reservedUrl!)} title="Copy link">
                <Copy className="size-3" />
              </Button>
            </div>
          ) : null}

          {preview.stub ? (
            <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">{preview.note}</p>
          ) : null}

          {/* Paused / destroyed */}
          {showLifecycle ? (
            <div
              className={cn(
                "space-y-2 rounded-lg border p-3 text-[11.5px]",
                phases.destroyed ? "border-rose-500/25 bg-rose-500/[0.06]" : "border-amber-500/25 bg-amber-500/[0.07]",
              )}
            >
              <div className="flex items-center gap-1.5 font-semibold text-foreground">
                {phases.destroyed ? <Power className="size-4 text-rose-500" /> : <PauseCircle className="size-4 text-amber-500" />}
                <span>{phases.destroyed ? "Sandbox was destroyed" : "Sandbox is paused"}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {phases.destroyed
                  ? "Nobody used the link for 30 minutes, so Fairlx tore the VM down to save cost. Restart to clone the latest code and get a fresh link."
                  : `Paused after 15 minutes idle. It is destroyed in ${formatIdleCountdown(lifecycle.nextTransitionInMs)} unless you restart it.`}
              </p>
              {onRestart ? (
                <Button type="button" size="sm" disabled={restartPending} onClick={onRestart} className="gap-1.5">
                  {restartPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                  {phases.destroyed ? "Restart & regenerate link" : "Restart sandbox"}
                </Button>
              ) : null}
            </div>
          ) : null}

          {/* Stuck — prepare finished or timed out without a live link */}
          {phases.stuck && !phases.failed && !showLifecycle ? (
            <div className="space-y-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] p-3 text-[11.5px] dark:bg-rose-500/10">
              <div className="flex items-center gap-1.5 font-semibold text-rose-700 dark:text-rose-300">
                <AlertCircle className="size-4 shrink-0 text-rose-500 dark:text-rose-400" />
                <span>This sandbox is stuck</span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {phases.current === "live"
                  ? "Fairlx reserved a preview link but the app never answered the health check. Reboot destroys this Azure VM and starts a fresh one from Git."
                  : "This step has been running far longer than it should. Reboot destroys the Azure VM and starts a fresh sandbox from Git."}
              </p>
              {healthLog ? (
                <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded border border-rose-500/10 bg-black/5 p-2 font-mono text-[10.5px] leading-relaxed text-zinc-700 dark:bg-black/25 dark:text-zinc-300">
                  {healthLog}
                </p>
              ) : null}
              {onRestart ? (
                <Button type="button" size="sm" disabled={restartPending} onClick={onRestart} className="gap-1.5">
                  {restartPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                  Reboot sandbox
                </Button>
              ) : null}
            </div>
          ) : null}

          {/* Failed */}
          {phases.failed ? (
            <div className="space-y-2 rounded-lg border border-red-500/25 bg-red-500/[0.07] p-3 text-[11.5px] dark:bg-red-500/10">
              <div className="flex items-center gap-1.5 font-semibold text-red-700 dark:text-red-300">
                <AlertCircle className="size-4 shrink-0 text-red-500 dark:text-red-400" />
                <span>Sandbox could not start</span>
              </div>
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded border border-red-500/10 bg-black/5 p-2 font-mono text-[10.5px] leading-relaxed text-zinc-700 dark:bg-black/25 dark:text-zinc-300">
                {lastError || "The Azure sandbox failed before the app started."}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {onRestart ? (
                  <Button type="button" size="sm" disabled={restartPending} onClick={onRestart} className="gap-1.5">
                    {restartPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                    Reboot sandbox
                  </Button>
                ) : onStart ? (
                  <Button type="button" size="xs" variant="secondary" disabled={startPending} onClick={onStart}>
                    {startPending ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                    Retry in Azure
                  </Button>
                ) : null}
                <span className="text-[10px] text-muted-foreground">Reboot tears down this VM and clones the repo again.</span>
              </div>
            </div>
          ) : null}

          {/* Live browser */}
          {phases.live && preview.url ? (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
              <BrowserChrome url={preview.url} viewport={viewport} onViewport={setViewport}>
                <div
                  className={cn(
                    "bg-background",
                    viewport === "phone" && "flex justify-center bg-zinc-200/80 py-3 dark:bg-zinc-900",
                  )}
                >
                  <iframe
                    key={`${frameSrc}:${viewport}`}
                    title="Sandbox app preview"
                    src={frameSrc}
                    className={cn(
                      "bg-background",
                      viewport === "phone" ? "h-[34rem] w-[390px] max-w-full rounded-lg border border-zinc-300 shadow-sm dark:border-white/10" : "min-h-[28rem] w-full",
                    )}
                  />
                </div>
              </BrowserChrome>
              <div className="flex items-center gap-2">
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-[11px] font-medium text-cyan-700 dark:text-cyan-300"
                >
                  {preview.url}
                </a>
                <Button type="button" size="xs" variant="secondary" asChild>
                  <a href={preview.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-3" /> Open
                  </a>
                </Button>
                <Button type="button" size="xs" variant="secondary" onClick={() => void copyLink(preview.url)}>
                  <Copy className="size-3" /> Share
                </Button>
                {onRestart ? (
                  <Button type="button" size="xs" variant="ghost" disabled={restartPending} onClick={onRestart} title="Rebuild from the latest Git code and regenerate the link">
                    {restartPending ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                  </Button>
                ) : null}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Public Azure URL — shareable without a Fairlx login while the sandbox runs. Opening it counts as activity.
              </p>
            </motion.div>
          ) : null}

          <SessionArtifacts session={session} embedded />
        </div>
      </AccentCard>

      {githubUrl ? (
        <a
          href={githubUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-300"
        >
          <span className="inline-flex items-center gap-2">
            <Server className="size-3.5" />
            Source: {repo?.owner}/{repo?.repositoryName}
          </span>
          <ExternalLink className="size-3.5" />
        </a>
      ) : null}
    </div>
  );
}