"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { useGetAgentBriefing } from "../api/use-agent-briefing";
import { useGetPersonalAgent, useResetPersonalAgent, useResolvePersonalStandin } from "../api/use-personal-agent";
import { profileIsTrained } from "../lib/personal-agent-status";
import { AgentFace, useAgentFaceMood } from "./agent-face";
import { PersonalAgentSetup } from "./personal-agent-setup";

const ROLE_TITLE: Record<string, string> = {
  tech_lead: "Tech Lead",
  frontend: "Frontend Engineer",
  qa: "QA Engineer",
  pm: "Product Manager",
};

const PRIORITY_TONE: Record<string, string> = {
  URGENT: "bg-red-500",
  HIGH: "bg-orange-500",
  MEDIUM: "bg-amber-400",
  LOW: "bg-muted-foreground/35",
};

export function DailyCockpit() {
  const { data: personal, isLoading: personalLoading } = useGetPersonalAgent();
  const { data: briefing, isLoading: briefingLoading } = useGetAgentBriefing();
  const reset = useResetPersonalAgent();
  const resolveStandin = useResolvePersonalStandin();
  const [confirmReset, setConfirmReset] = useState(false);
  const pendingStandin = personal?.pendingStandin ?? [];

  const trained = profileIsTrained(personal?.profile);
  const faceMood = useAgentFaceMood(undefined, {
    awaitingYou: pendingStandin.length > 0,
    typing: false,
  });
  const mood = briefingLoading && trained ? "thinking" : faceMood;
  const identity =
    personal?.profile?.jobTitle?.trim() ||
    ROLE_TITLE[personal?.profile?.personaRole ?? ""] ||
    "Personal Agent";
  const statusLine = pendingStandin.length
    ? `${pendingStandin.length} draft${pendingStandin.length === 1 ? "" : "s"} waiting`
    : briefingLoading
      ? "Briefing…"
      : "Standing by";

  return (
    <section className="rounded-2xl border border-border/70 bg-card overflow-hidden">
      <div className="p-4">
        {personalLoading ? (
          <div className="flex items-center gap-3 py-0.5">
            <div className="size-9 rounded-full bg-muted animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-28 rounded-full bg-muted animate-pulse" />
              <div className="h-2.5 w-36 rounded-full bg-muted/70 animate-pulse" />
            </div>
          </div>
        ) : trained ? (
          <>
            <header className="flex items-center gap-3">
              <AgentFace mood={mood} size={36} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium tracking-tight text-foreground leading-none truncate">
                  {identity}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 truncate">{statusLine}</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="size-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 flex items-center justify-center shrink-0"
                    aria-label="Cockpit menu"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setConfirmReset(true)}
                  >
                    Reset training
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </header>

            {pendingStandin.length ? (
              <div className="mt-4 space-y-2">
                {pendingStandin.map((item) => (
                  <div key={item.id} className="rounded-xl bg-muted/40 px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">Needs you</p>
                    <p className="text-[12px] text-foreground mt-1 leading-relaxed line-clamp-3">{item.draft}</p>
                    <div className="flex flex-wrap gap-3 mt-2.5">
                      <button
                        type="button"
                        disabled={resolveStandin.isPending}
                        onClick={() => resolveStandin.mutate({ jobId: item.id, action: "approve" })}
                        className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={resolveStandin.isPending}
                        onClick={() => resolveStandin.mutate({ jobId: item.id, action: "self" })}
                        className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        I&apos;ll answer
                      </button>
                      {item.workspaceId && item.taskId ? (
                        <Link
                          href={`/workspaces/${item.workspaceId}/tasks/${item.taskId}`}
                          className="text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          Open
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {briefingLoading ? (
              <div className="mt-4 space-y-2">
                <div className="h-2.5 w-full rounded-full bg-muted/50 animate-pulse" />
                <div className="h-2.5 w-4/5 rounded-full bg-muted/40 animate-pulse" />
              </div>
            ) : briefing ? (
              <div className="mt-4 space-y-4">
                {briefing.priorities.length ? (
                  <ol className="space-y-2">
                    {briefing.priorities.slice(0, 3).map((line, index) => (
                      <li key={line} className="flex gap-2.5 text-[12px] text-foreground/90 leading-snug">
                        <span className="w-3 shrink-0 text-[10px] tabular-nums text-muted-foreground pt-px">
                          {index + 1}
                        </span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}

                {briefing.blockers.length ? (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Blocked · {briefing.blockers.join(" · ")}
                  </p>
                ) : null}

                <div>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
                      Assigned
                    </p>
                    {briefing.topTasks?.length ? (
                      <span className="text-[10px] tabular-nums text-muted-foreground/70">
                        {briefing.topTasks.length}
                      </span>
                    ) : null}
                  </div>
                  {briefing.topTasks?.length ? (
                    <ul>
                      {briefing.topTasks.slice(0, 4).map((task) => {
                        const priorityKey = String(task.priority || "").toUpperCase();
                        return (
                          <li key={task.id}>
                            <Link
                              href={
                                task.workspaceId
                                  ? `/workspaces/${task.workspaceId}/tasks/${task.id}`
                                  : "/agent/projects"
                              }
                              className="flex items-center gap-2 rounded-md py-1.5 hover:bg-muted/50 -mx-1 px-1 transition-colors"
                            >
                              <span
                                className={cn(
                                  "size-1.5 rounded-full shrink-0",
                                  PRIORITY_TONE[priorityKey] ?? PRIORITY_TONE.LOW,
                                )}
                              />
                              <span className="min-w-0 flex-1 text-[12px] text-foreground truncate">
                                {[task.key, task.title].filter(Boolean).join("  ")}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-[12px] text-muted-foreground py-1">Nothing assigned.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-[12px] text-muted-foreground">Sign in to load your briefing.</p>
            )}

            <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset Personal Agent?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes the trained profile, interview answers, inferred workspace data, and
                    training chats. You will need to train or self-train again.
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
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <AgentFace mood="idle" size={36} />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground leading-none">Personal Agent</p>
                <p className="text-[11px] text-muted-foreground mt-1">Train it on how you work</p>
              </div>
            </div>
            <PersonalAgentSetup compact hideIntro />
          </div>
        )}
      </div>
    </section>
  );
}
