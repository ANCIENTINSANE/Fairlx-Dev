"use client";

import { Ban, Check, CircleDot, ClipboardList, GitBranch } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ImplementationPlan, ImplementationPlanTaskStatus } from "../types";
import { parseImplementationPlan, planCompletion } from "../lib/implementation-plan";
import { specialistTone, type SidebarToneName } from "../lib/sidebar-theme";
import { AccentCard, SidebarIconWell, StatusPill } from "./workflow-sidebar-ui";

function planTone(status: ImplementationPlan["status"], percent: number): SidebarToneName {
  if (status === "rejected") return "rose";
  if (status === "accepted" && percent >= 100) return "emerald";
  if (status === "accepted") return "blue";
  return "violet";
}

function statusKind(status: ImplementationPlan["status"]): "done" | "danger" | "info" | "live" {
  if (status === "accepted") return "done";
  if (status === "rejected") return "danger";
  return "info";
}

function TaskStatusMark({ status }: { status: ImplementationPlanTaskStatus }) {
  if (status === "done") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-amber-500 bg-amber-500/15">
        <CircleDot className="size-3 text-amber-600 dark:text-amber-400" />
      </span>
    );
  }
  if (status === "blocked") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400">
        <Ban className="size-3" />
      </span>
    );
  }
  return <span className="size-5 shrink-0 rounded-full border-2 border-muted-foreground/25 bg-background" />;
}

export function ImplementationPlanCard({
  plan,
  compact,
}: {
  plan?: ImplementationPlan | null;
  compact?: boolean;
}) {
  const parsed = parseImplementationPlan(plan);
  if (!parsed) return null;
  const { percent, done, total } = planCompletion(parsed);
  const tone = planTone(parsed.status, percent);

  return (
    <AccentCard tone={tone}>
      <div className={cn("min-w-0", compact ? "p-3" : "p-4")}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <SidebarIconWell icon={ClipboardList} tone={tone} />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Implementation plan
              </p>
              <h3 className="text-[15px] font-semibold leading-snug text-foreground break-words">
                {parsed.title}
              </h3>
            </div>
          </div>
          <StatusPill kind={statusKind(parsed.status)} className="shrink-0 capitalize">
            {parsed.status}
          </StatusPill>
        </div>

        {parsed.summary ? (
          <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground break-words">{parsed.summary}</p>
        ) : null}

        <div className="mb-1 flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-medium tabular-nums text-muted-foreground">
            {done}/{total} tasks
          </p>
          <p className="text-[11px] font-semibold tabular-nums text-foreground">{percent}%</p>
        </div>
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              percent >= 100 ? "bg-emerald-500" : "bg-blue-500",
            )}
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>

        <div className="space-y-3">
          {parsed.phases.map((phase, index) => {
            const phaseDone = phase.tasks.filter((task) => task.status === "done").length;
            const phaseTotal = phase.tasks.length;
            const phaseComplete = phaseTotal > 0 && phaseDone === phaseTotal;
            return (
              <section key={phase.id || index} className="min-w-0">
                <div className="mb-1.5 flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold tabular-nums",
                      phaseComplete
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-blue-500/15 text-blue-700 dark:text-blue-300",
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className="text-[13px] font-semibold leading-snug text-foreground break-words">
                        {phase.title}
                      </h4>
                      <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                        {phaseDone}/{phaseTotal}
                      </span>
                    </div>
                    <ul className="mt-1.5 space-y-1.5">
                      {phase.tasks.map((task) => {
                        const specialist = task.specialist ? specialistTone(task.specialist) : null;
                        return (
                          <li key={task.id} className="flex items-start gap-2">
                            <TaskStatusMark status={task.status} />
                            <div className="min-w-0 flex-1 pt-px">
                              <p
                                className={cn(
                                  "text-[13px] leading-relaxed break-words",
                                  task.status === "done"
                                    ? "text-muted-foreground"
                                    : "text-foreground",
                                )}
                              >
                                {task.title}
                              </p>
                              {task.specialist ? (
                                <span
                                  className={cn(
                                    "mt-0.5 inline-flex rounded-full px-1.5 py-px text-[10px] font-semibold capitalize",
                                    specialist?.bg,
                                    specialist?.text,
                                  )}
                                >
                                  {task.specialist}
                                </span>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        {parsed.repo?.owner && parsed.repo.name ? (
          <p className="mt-4 flex items-start gap-1.5 text-[11px] text-muted-foreground break-all">
            <GitBranch className="mt-0.5 size-3 shrink-0" />
            <span>
              {parsed.repo.owner}/{parsed.repo.name}
              {parsed.repo.exists === false ? " · not attached yet" : ""}
            </span>
          </p>
        ) : null}
      </div>
    </AccentCard>
  );
}
