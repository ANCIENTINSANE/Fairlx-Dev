"use client";

import { useState } from "react";
import Link from "next/link";
import { Calendar, FlagIcon, MoreHorizontal } from "lucide-react";

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
import { StatusDisplay } from "@/features/custom-columns/components/status-display";
import { useGetProject } from "@/features/projects/api/use-get-project";
import { LabelBadge } from "@/features/tasks/components/LabelBadge";
import { PriorityBadge } from "@/features/tasks/components/priority-selector";
import { WorkItemIcon } from "@/features/timeline/components/work-item-icon";
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

function dueCopy(dueAt?: string): { text: string; className: string } | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const days = Math.round((due.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { text: "Overdue", className: "text-red-600 dark:text-red-400" };
  if (days === 0) return { text: "Due today", className: "text-red-600 dark:text-red-400" };
  if (days === 1) return { text: "Due tomorrow", className: "text-orange-600 dark:text-orange-400" };
  if (days <= 2) return { text: "Due in 2 days", className: "text-orange-600 dark:text-orange-400" };
  if (days <= 7) return { text: `Due in ${days} days`, className: "text-muted-foreground" };
  return {
    text: due.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    className: "text-muted-foreground",
  };
}

export function CockpitWorkItem({
  task,
}: {
  task: {
    id: string;
    key?: string;
    title: string;
    status?: string;
    priority?: string;
    type?: string;
    workspaceId?: string;
    projectId?: string;
    dueAt?: string;
    labels?: string[];
    flagged?: boolean;
  };
}) {
  const { data: project } = useGetProject({
    projectId: task.projectId,
    enabled: Boolean(task.projectId),
  });
  const due = dueCopy(task.dueAt);
  const href = task.workspaceId ? `/workspaces/${task.workspaceId}/tasks/${task.id}` : "/agent/projects";
  const customPriority = project?.customPriorities?.find((item) => item.key === task.priority);
  const customLabels = project?.customLabels ?? [];
  const labels = task.labels ?? [];
  const visibleLabels = labels.slice(0, 3);
  const hiddenLabelCount = labels.length - visibleLabels.length;

  return (
    <Link
      href={href}
      className="block rounded-xl border border-border/70 bg-background/60 px-2.5 py-2 hover:bg-muted/50 hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <WorkItemIcon type={task.type || "TASK"} className="size-4 shrink-0" project={project} />
          {task.key ? (
            <span className="shrink-0 font-mono text-[11px] font-semibold text-muted-foreground">
              {task.key}
            </span>
          ) : null}
        </div>
        {task.priority ? (
          <PriorityBadge priority={task.priority} className="h-5 px-1.5 shrink-0" color={customPriority?.color} />
        ) : null}
      </div>
      <p className="mt-1.5 flex items-start gap-1.5 text-[12px] font-medium text-foreground leading-snug line-clamp-2">
        {task.flagged ? (
          <FlagIcon className="size-3.5 fill-red-500 text-red-500 shrink-0 mt-0.5" />
        ) : null}
        <span>{task.title}</span>
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {task.status ? (
          <StatusDisplay status={task.status} projectId={task.projectId} workspaceId={task.workspaceId} />
        ) : null}
        {visibleLabels.map((label) => {
          const customLabel = customLabels.find((item) => item.name.toLowerCase() === label.toLowerCase());
          return <LabelBadge key={label} label={label} className="h-5 px-1.5" color={customLabel?.color} />;
        })}
        {hiddenLabelCount > 0 ? (
          <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 border border-border">
            +{hiddenLabelCount}
          </span>
        ) : null}
        {due ? (
          <span className={cn("inline-flex items-center gap-1 text-[10px] ml-auto", due.className)}>
            <Calendar className="size-3" />
            {due.text}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

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
  const dueSoonCount = (briefing?.topTasks ?? []).filter((task) => {
    if (!task.dueAt) return false;
    const due = new Date(task.dueAt).getTime();
    if (Number.isNaN(due)) return false;
    return due - Date.now() <= 48 * 60 * 60 * 1000;
  }).length;
  const assignedCount = briefing?.topTasks?.length ?? 0;
  const statusLine = pendingStandin.length
    ? `${pendingStandin.length} draft${pendingStandin.length === 1 ? "" : "s"} waiting`
    : briefingLoading
      ? "Briefing…"
      : dueSoonCount
        ? `${dueSoonCount} due soon`
        : assignedCount
          ? `${assignedCount} assigned`
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
                  <div className="flex items-baseline justify-between gap-2 mb-1.5">
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
                    <ul className="space-y-2">
                      {briefing.topTasks.slice(0, 5).map((task) => (
                        <li key={task.id}>
                          <CockpitWorkItem task={task} />
                        </li>
                      ))}
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
