"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Bot, Eye, FlaskConical, GitBranch, Hammer, Mail, Map as MapIcon, Search, Shield, Workflow, Zap } from "lucide-react";

import { cn } from "@/lib/utils";

import type { AgentAiConfigPublic, AgentRun } from "../types";
import { crewModelHints } from "../lib/client-defaults";
import type { RouteDecision } from "../lib/fairlx-router";
import { specialistTone } from "../lib/sidebar-theme";
import { buildAgentCrew, crewHeadlineCounts, type AgentCrew, type AgentCrewInstance } from "../lib/subagent-tree";

const ICONS: Record<string, LucideIcon> = {
  orchestrator: Bot,
  planner: MapIcon,
  researcher: Search,
  builder: Hammer,
  git: GitBranch,
  tester: FlaskConical,
  reviewer: Eye,
  ops: Mail,
  security: Shield,
  workflow: Workflow,
};

const VERBS: Record<string, string> = {
  orchestrator: "routing",
  planner: "planning",
  researcher: "digging",
  builder: "hammering",
  git: "branching",
  tester: "poking it",
  reviewer: "squinting",
  ops: "dispatching",
  security: "auditing",
  workflow: "wiring",
};

/** Per-specialist idle motion so the stage doesn't look like a spreadsheet. */
const WORK_MOTION: Record<string, { rotate?: number[]; y?: number[]; x?: number[] }> = {
  builder: { rotate: [0, -18, 6, 0], y: [0, -2, 1, 0] },
  researcher: { x: [0, 3, -3, 0], y: [0, -1, 1, 0] },
  planner: { rotate: [0, 4, -4, 0] },
  reviewer: { x: [0, -2, 2, 0] },
  tester: { y: [0, -4, 0], rotate: [0, 8, 0] },
  git: { rotate: [0, 360] },
  orchestrator: { y: [0, -2, 0] },
};

function flattenInstances(nodes: AgentCrewInstance[]): AgentCrewInstance[] {
  return nodes.flatMap((node) => [node, ...flattenInstances(node.children)]);
}

function Avatar({
  specialist,
  name,
  live,
  total,
  action,
  modelName,
  center,
}: {
  specialist: string;
  name: string;
  live: number;
  total: number;
  action?: string;
  modelName?: string;
  center?: boolean;
}) {
  const tone = specialistTone(specialist);
  const Icon = ICONS[specialist] || Bot;
  const working = live > 0;
  const seen = total > 0;
  const motionSpec = WORK_MOTION[specialist] || { y: [0, -2, 0] };
  return (
    <motion.div
      layout
      className={cn("flex flex-col items-center gap-1 text-center", center ? "col-span-2 sm:col-span-1" : "")}
      style={{ perspective: 300 }}
      title={`${name}${action ? ` — ${action}` : ""}`}
    >
      <motion.div
        className={cn(
          "relative flex size-12 items-center justify-center rounded-2xl border shadow-sm transition-colors",
          working
            ? cn(tone.card, tone.border, "shadow-[0_10px_24px_-14px_rgba(0,0,0,0.45)]")
            : seen
              ? "border-border bg-card"
              : "border-dashed border-border/70 bg-muted/30 opacity-60",
        )}
        style={{ transformStyle: "preserve-3d" }}
        animate={
          working
            ? { rotateX: [8, 14, 8], rotateY: [-10, 10, -10], y: [0, -3, 0] }
            : { rotateX: 10, rotateY: -12, y: 0 }
        }
        transition={working ? { duration: 2.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.6 }}
      >
        {/* depth slab */}
        <span
          className={cn("absolute inset-0 rounded-2xl", working ? tone.bg : "bg-black/5 dark:bg-white/5")}
          style={{ transform: "translateZ(-6px) translateY(3px)" }}
        />
        <motion.span
          className={cn("relative", working ? tone.text : seen ? "text-foreground/70" : "text-muted-foreground")}
          style={{ transform: "translateZ(8px)" }}
          animate={working ? motionSpec : { rotate: 0, x: 0, y: 0 }}
          transition={
            working
              ? specialist === "git"
                ? { duration: 2.4, repeat: Infinity, ease: "linear" }
                : { duration: 0.9, repeat: Infinity, repeatDelay: 0.5, ease: "easeInOut" }
              : { duration: 0.3 }
          }
        >
          <Icon className="size-5" />
        </motion.span>
        {working ? (
          <span className="absolute -right-1 -top-1 flex size-3.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" />
            <span className="relative size-3.5 rounded-full border-2 border-background bg-emerald-500" />
          </span>
        ) : null}
        {total > 1 ? (
          <span className="absolute -bottom-1.5 -right-1.5 rounded-full border border-background bg-foreground px-1.5 text-[9px] font-bold tabular-nums text-background">
            {working ? `${live}/${total}` : total}
          </span>
        ) : null}
      </motion.div>
      <div className="min-w-0">
        <p className={cn("text-[10.5px] font-semibold leading-3.5", working ? "text-foreground" : "text-muted-foreground")}>{name}</p>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={working ? action || VERBS[specialist] || "working" : seen ? "done" : "idle"}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            className={cn("max-w-[5.5rem] truncate text-[9.5px] leading-3.5", working ? tone.soft : "text-muted-foreground/70")}
          >
            {working ? VERBS[specialist] || "working" : seen ? "done" : "on the bench"}
          </motion.p>
        </AnimatePresence>
        {modelName && (working || center) ? (
          <p className="max-w-[5.5rem] truncate text-[9px] leading-3 text-muted-foreground/80">{modelName}</p>
        ) : null}
      </div>
    </motion.div>
  );
}

function statLabel(crew: AgentCrew, headline: { live: number; launched: number }) {
  if (headline.live === 0 && headline.launched === 0) return crew.orchestratorStatus === "working" ? "Orchestrator is thinking solo" : "Crew is on the bench";
  if (headline.live === 0) return `${headline.launched} deployed this turn · all reported back`;
  return `${headline.live} working now · ${headline.launched} deployed this turn`;
}

export function CrewStage({
  run,
  ai,
  route,
}: {
  run?: AgentRun;
  ai?: AgentAiConfigPublic;
  route?: RouteDecision | null;
}) {
  const crew = useMemo(() => buildAgentCrew(run?.events ?? [], run?.status, crewModelHints(ai, run)), [run, ai]);
  const headline = crewHeadlineCounts(crew);
  const instances = useMemo(() => flattenInstances(crew.children), [crew.children]);
  const actionBySpecialist = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of instances) {
      if (node.status === "working" && (node.currentAction || node.lastAction)) map.set(node.specialist, node.currentAction || node.lastAction || "");
    }
    return map;
  }, [instances]);
  const live = crew.orchestratorStatus === "working" || crew.live > 0;
  const roster = crew.roster.filter((item) => item.specialist !== "orchestrator");
  const activeRoster = roster.filter((item) => item.live > 0 || item.total > 0);
  const benched = roster.filter((item) => item.live === 0 && item.total === 0);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">Crew</div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums",
            live ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
          )}
        >
          {live ? <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> : null}
          {headline.live} live · {headline.launched} deployed
        </span>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-sidebar-border bg-gradient-to-b from-sidebar-accent/40 to-transparent p-3">
        {/* stage floor */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-6 bottom-2 h-10 rounded-[100%] bg-gradient-to-t from-foreground/[0.06] to-transparent blur-md"
        />
        <div className="relative grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4">
          <Avatar
            specialist="orchestrator"
            name="Orchestrator"
            live={crew.orchestratorStatus === "working" ? 1 : 0}
            total={1}
            action={crew.orchestratorAction}
            modelName={route?.displayName || crew.orchestratorModelName}
            center
          />
          {activeRoster.map((item) => (
            <Avatar
              key={item.specialist}
              specialist={item.specialist}
              name={item.name}
              live={item.live}
              total={item.total}
              action={actionBySpecialist.get(item.specialist)}
              modelName={item.modelName}
            />
          ))}
        </div>
        {benched.length ? (
          <div className="relative mt-3 flex flex-wrap items-center gap-1.5 border-t border-dashed border-sidebar-border pt-2.5">
            <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground/70">Bench</span>
            {benched.map((item) => {
              const Icon = ICONS[item.specialist] || Bot;
              return (
                <span
                  key={item.specialist}
                  title={`${item.name} — ${item.role}`}
                  className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/60 px-1.5 py-0.5 text-[9.5px] text-muted-foreground"
                >
                  <Icon className="size-2.5" />
                  {item.name}
                </span>
              );
            })}
          </div>
        ) : null}
        <p className="relative mt-2.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <Zap className="size-3 text-amber-500" />
          {statLabel(crew, headline)}
          {crew.live > 0 ? ` · ${crew.live}/${crew.parallelCap} parallel slots` : ""}
        </p>
      </div>
    </section>
  );
}
