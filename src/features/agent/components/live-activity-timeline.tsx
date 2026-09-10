"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode,
  Globe,
  ListChecks,
  MessageCircleQuestion,
  Route,
  Search,
  ShieldCheck,
  SquareTerminal,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { clockTime } from "../lib/agent-ui";
import type { AgentToolEvent } from "../types";

type Kind = "thought" | "route" | "tool_start" | "terminal" | "search" | "code" | "subagent" | "plan" | "question" | "check" | "error" | "tool";

function kindOf(event: AgentToolEvent): Kind {
  const type = event.type;
  if (type === "error") return "error";
  if (type === "thought" || type === "job_progress") return "thought";
  if (type === "model_route") return "route";
  if (type === "tool_start") return "tool_start";
  if (type === "terminal" || type === "coding_session_exec") return "terminal";
  if (type === "web_search" || type === "web_fetch" || type === "file_search" || type === "search_harness") return "search";
  if (type.startsWith("github_") || type === "code_inspect" || type === "git_stage" || type === "coding_session_implement") return "code";
  if (type.startsWith("subagent_") || type === "delegate_agent") return "subagent";
  if (type === "submit_implementation_plan") return "plan";
  if (type === "ask_user" || type === "ask_user_resolved" || type === "confirmation") return "question";
  if (type === "security_review" || type === "confirmation_resolved") return "check";
  return "tool";
}

const KIND_META: Record<Kind, { icon: LucideIcon; tone: string; ring: string }> = {
  thought: { icon: Brain, tone: "text-violet-600 dark:text-violet-300", ring: "bg-violet-500/15" },
  route: { icon: Route, tone: "text-fuchsia-600 dark:text-fuchsia-300", ring: "bg-fuchsia-500/15" },
  tool_start: { icon: Wrench, tone: "text-sky-600 dark:text-sky-300", ring: "bg-sky-500/15" },
  terminal: { icon: SquareTerminal, tone: "text-amber-600 dark:text-amber-300", ring: "bg-amber-500/15" },
  search: { icon: Search, tone: "text-blue-600 dark:text-blue-300", ring: "bg-blue-500/15" },
  code: { icon: FileCode, tone: "text-emerald-600 dark:text-emerald-300", ring: "bg-emerald-500/15" },
  subagent: { icon: Bot, tone: "text-indigo-600 dark:text-indigo-300", ring: "bg-indigo-500/15" },
  plan: { icon: ListChecks, tone: "text-blue-700 dark:text-blue-300", ring: "bg-blue-500/15" },
  question: { icon: MessageCircleQuestion, tone: "text-rose-600 dark:text-rose-300", ring: "bg-rose-500/15" },
  check: { icon: ShieldCheck, tone: "text-teal-600 dark:text-teal-300", ring: "bg-teal-500/15" },
  error: { icon: AlertTriangle, tone: "text-red-600 dark:text-red-300", ring: "bg-red-500/15" },
  tool: { icon: Globe, tone: "text-zinc-600 dark:text-zinc-300", ring: "bg-zinc-500/15" },
};

function specialistOf(event: AgentToolEvent): string | undefined {
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as { specialist?: string }) : {};
  return typeof payload.specialist === "string" ? payload.specialist : undefined;
}

function Row({ event, latest, live }: { event: AgentToolEvent; latest: boolean; live: boolean }) {
  const [open, setOpen] = useState(false);
  const kind = kindOf(event);
  const meta = KIND_META[kind];
  const Icon = kind === "tool_start" && !live ? Check : meta.icon;
  const specialist = specialistOf(event);
  const thinking = kind === "thought";
  const longDetail = (event.detail?.length ?? 0) > 140;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="relative flex gap-2.5"
    >
      <span className="relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center">
        {latest && live ? <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", meta.ring)} /> : null}
        <span className={cn("relative flex size-6 items-center justify-center rounded-full", meta.ring, meta.tone)}>
          <Icon className="size-3" />
        </span>
      </span>
      <div className="min-w-0 flex-1 pb-3">
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            onClick={() => (event.detail ? setOpen((value) => !value) : undefined)}
            className={cn(
              "min-w-0 flex-1 text-left text-[11.5px] leading-4",
              thinking ? "italic text-foreground/80" : "text-foreground",
              kind === "error" && "font-medium text-red-600 dark:text-red-300",
              latest && live && "font-medium",
            )}
          >
            {kind === "tool_start" && !live ? event.title.replace(/^Running /, "Ran ") : event.title}
            {specialist ? (
              <span className="ml-1.5 rounded bg-muted px-1 py-px text-[9px] font-medium not-italic uppercase tracking-wide text-muted-foreground">
                {specialist}
              </span>
            ) : null}
          </button>
          <time className="shrink-0 font-mono text-[9.5px] tabular-nums text-muted-foreground">{clockTime(event.createdAt, true)}</time>
        </div>
        {event.detail ? (
          <div className="mt-0.5">
            <p
              className={cn(
                "whitespace-pre-wrap break-words text-[10.5px] leading-4 text-muted-foreground",
                !open && "line-clamp-2",
              )}
            >
              {event.detail}
            </p>
            {longDetail ? (
              <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                {open ? "less" : "more"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </motion.li>
  );
}

export function LiveActivityTimeline({
  events,
  live,
  status,
  limit = 30,
}: {
  events: AgentToolEvent[];
  live: boolean;
  status: string;
  limit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const visible = showAll ? events : events.slice(-limit);
  const hidden = events.length - visible.length;
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    const kind = kindOf(event);
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between px-0.5">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50 transition-colors hover:text-sidebar-foreground/70"
        >
          {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
          Live activity
          <span className="ml-1 rounded-full bg-muted px-1.5 text-[9.5px] tabular-nums normal-case text-muted-foreground">{events.length}</span>
        </button>
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            live
          </span>
        ) : (
          <span className="text-[10px] font-medium capitalize text-muted-foreground">{status.replace(/_/g, " ")}</span>
        )}
      </div>

      {!collapsed && events.length ? (
        <div className="mb-2 flex flex-wrap gap-1 px-0.5">
          {(["thought", "search", "code", "terminal", "subagent", "error"] as Kind[])
            .filter((kind) => counts[kind])
            .map((kind) => {
              const meta = KIND_META[kind];
              const Icon = meta.icon;
              return (
                <span key={kind} className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9.5px] font-medium tabular-nums", meta.ring, meta.tone)}>
                  <Icon className="size-2.5" />
                  {counts[kind]}
                </span>
              );
            })}
        </div>
      ) : null}

      {events.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">Nothing yet — the first thought lands here.</p>
      ) : collapsed ? (
        <p className="px-1 text-xs text-muted-foreground">
          {events.length} {events.length === 1 ? "event" : "events"} · expand to review
        </p>
      ) : (
        <div className="relative">
          <span aria-hidden className="absolute bottom-3 left-[11px] top-1 w-px bg-gradient-to-b from-border via-border to-transparent" />
          {hidden > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="relative z-10 mb-2 ml-8 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Show {hidden} earlier {hidden === 1 ? "event" : "events"}
            </button>
          ) : null}
          <ol className="relative">
            <AnimatePresence initial={false}>
              {visible.map((event, index) => (
                <Row key={event.id} event={event} latest={index === visible.length - 1} live={live} />
              ))}
            </AnimatePresence>
          </ol>
          {live ? (
            <div className="relative flex items-center gap-2.5 pl-[3px] text-[10.5px] text-muted-foreground">
              <span className="flex size-[18px] items-center justify-center">
                <span className="size-2 animate-pulse rounded-full bg-primary" />
              </span>
              <span className="inline-flex items-center gap-1">
                thinking
                <span className="inline-flex gap-0.5">
                  {[0, 1, 2].map((index) => (
                    <motion.span
                      key={index}
                      className="size-1 rounded-full bg-current"
                      animate={{ opacity: [0.2, 1, 0.2] }}
                      transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.2 }}
                    />
                  ))}
                </span>
              </span>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
