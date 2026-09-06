"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, RotateCcw, Sparkles, Zap, Clock } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useGetAgentBriefing } from "../api/use-agent-briefing";
import { useGetPersonalAgent, useResetPersonalAgent } from "../api/use-personal-agent";
import { profileIsTrained } from "../lib/personal-agent-status";
import { PersonalAgentSetup } from "./personal-agent-setup";

const PRIORITY_TONE: Record<string, string> = {
  URGENT: "bg-red-500",
  HIGH: "bg-orange-500",
  MEDIUM: "bg-amber-400",
  LOW: "bg-muted-foreground/40",
};

const PRIORITY_GLOW: Record<string, string> = {
  URGENT: "shadow-[0_0_6px_rgba(239,68,68,0.4)]",
  HIGH: "shadow-[0_0_6px_rgba(249,115,22,0.3)]",
  MEDIUM: "",
  LOW: "",
};

export function DailyCockpit() {
  const { data: personal, isLoading: personalLoading } = useGetPersonalAgent();
  const { data: briefing, isLoading: briefingLoading } = useGetAgentBriefing();
  const reset = useResetPersonalAgent();
  const [confirmReset, setConfirmReset] = useState(false);

  const trained = profileIsTrained(personal?.profile);

  return (
    <section className="relative overflow-hidden bg-card border border-border rounded-2xl shadow-md">
      {/* Premium gradient header band */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-primary/[0.06] via-primary/[0.03] to-transparent" />
      <div className="pointer-events-none absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-primary/[0.04] to-transparent rounded-bl-full" />

      <div className="relative p-5">
        {personalLoading ? (
          <div className="space-y-3.5 py-3">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-muted animate-pulse" />
              <div className="space-y-2 flex-1">
                <div className="h-3 w-24 rounded-full bg-muted animate-pulse" />
                <div className="h-2.5 w-40 rounded-full bg-muted/70 animate-pulse" />
              </div>
            </div>
            <div className="h-3 w-full rounded-full bg-muted/60 animate-pulse" />
            <div className="h-3 w-3/4 rounded-full bg-muted/50 animate-pulse" />
          </div>
        ) : trained ? (
          <>
            {/* Header with bot identity */}
            <div className="flex items-start justify-between mb-5 gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <span className="size-10 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 text-primary flex items-center justify-center shrink-0 shadow-sm">
                  <Bot className="size-[18px]" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground text-xs uppercase tracking-[0.14em]">
                      Daily cockpit
                    </h3>
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      <span className="relative flex size-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                      </span>
                      Active
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Trained on how you work</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {briefing ? (
                  <span className="inline-flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground bg-muted/50 rounded-full px-2 py-0.5 border border-border/50">
                    <Zap className="size-2.5 text-primary/60" />
                    {Math.round(briefing.generatedInMs)}ms
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  disabled={reset.isPending}
                  className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:text-destructive hover:border-destructive/30 hover:bg-destructive/5 transition-all duration-200 disabled:opacity-50"
                >
                  <RotateCcw className="size-3" />
                  Reset
                </button>
              </div>
            </div>

            {/* Briefing content */}
            {briefingLoading ? (
              <div className="space-y-3 py-1">
                <div className="h-4 w-56 rounded-full bg-muted/60 animate-pulse" />
                <div className="h-3 w-full rounded-full bg-muted/40 animate-pulse" />
                <div className="h-3 w-4/5 rounded-full bg-muted/30 animate-pulse" />
              </div>
            ) : !briefing ? (
              <p className="text-xs text-muted-foreground">Sign in to load your role-aware briefing.</p>
            ) : (
              <div className="space-y-5">
                {/* Greeting */}
                <div className="bg-muted/30 rounded-xl px-4 py-3 border border-border/40">
                  <p className="text-[15px] font-semibold tracking-tight text-foreground">{briefing.greeting}</p>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{briefing.headline}</p>
                </div>

                {/* Today's priorities */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="size-3 text-primary/70" />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Today&apos;s Focus
                    </p>
                  </div>
                  <ul className="space-y-2">
                    {briefing.priorities.map((line) => (
                      <li key={line} className="text-xs text-foreground leading-relaxed pl-4 relative">
                        <span className="absolute left-0 top-[7px] size-1.5 rounded-full bg-primary/50" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Blockers */}
                {briefing.blockers.length ? (
                  <div className="bg-destructive/5 border border-destructive/15 rounded-lg px-3.5 py-2.5">
                    <p className="text-[11px] font-semibold text-destructive/80 uppercase tracking-wider mb-1">Blockers</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {briefing.blockers.join(" · ")}
                    </p>
                  </div>
                ) : null}

                {/* Suggested action */}
                {briefing.suggestedActions[0] ? (
                  <p className="text-[11px] text-primary font-medium leading-relaxed flex items-start gap-1.5">
                    <Zap className="size-3 shrink-0 mt-0.5" />
                    {briefing.suggestedActions[0]}
                  </p>
                ) : null}

                {/* Top tasks */}
                <div className="pt-1.5 border-t border-border/60">
                  <div className="flex items-center gap-2 mb-3 mt-3">
                    <Clock className="size-3 text-muted-foreground/60" />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Top tasks
                    </p>
                  </div>
                  {briefing.topTasks?.length ? (
                    <div className="space-y-0.5">
                      {briefing.topTasks.map((task) => {
                        const priorityKey = String(task.priority || "").toUpperCase();
                        return (
                          <Link
                            key={task.id}
                            href={
                              task.workspaceId
                                ? `/workspaces/${task.workspaceId}/tasks/${task.id}`
                                : "/agent/projects"
                            }
                            className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-muted/50 transition-colors group"
                          >
                            <span
                              className={`mt-1.5 size-2 rounded-full shrink-0 ${PRIORITY_TONE[priorityKey] ?? PRIORITY_TONE.LOW} ${PRIORITY_GLOW[priorityKey] ?? ""}`}
                            />
                            <span className="min-w-0">
                              <span className="block text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">
                                {[task.key, task.title].filter(Boolean).join(" · ")}
                              </span>
                              <span className="block text-[11px] text-muted-foreground mt-0.5">
                                {[task.status, task.priority].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">No open tasks assigned to you.</p>
                  )}
                </div>
              </div>
            )}
            <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure you want to reset?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes the trained profile, interview answers, inferred workspace data, and
                    training chats from the database. You will need to train or self-train again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={reset.isPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={reset.isPending}
                    onClick={(event) => {
                      event.preventDefault();
                      reset.mutate(undefined, {
                        onSuccess: () => setConfirmReset(false),
                      });
                    }}
                  >
                    {reset.isPending ? "Deleting…" : "Reset"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <PersonalAgentSetup />
        )}
      </div>
    </section>
  );
}
