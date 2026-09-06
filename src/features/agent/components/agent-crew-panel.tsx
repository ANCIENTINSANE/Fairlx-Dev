"use client";

import { Bot, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AgentRun } from "../types";
import {
  buildAgentCrew,
  specialistDisplayName,
  type AgentCrewInstance,
  type AgentCrewStatus,
} from "../lib/subagent-tree";

function StatusDot({ status, className }: { status: AgentCrewStatus | "working" | "done"; className?: string }) {
  if (status === "working") {
    return (
      <span className={cn("relative flex size-2 shrink-0", className)}>
        <span className="absolute inset-0 rounded-full bg-primary/40 animate-ping" />
        <span className="relative size-2 rounded-full bg-primary" />
      </span>
    );
  }
  if (status === "done") {
    return <span className={cn("size-2 rounded-full bg-emerald-500/80 shrink-0", className)} />;
  }
  return <span className={cn("size-2 rounded-full border border-muted-foreground/50 shrink-0", className)} />;
}

function statusLabel(status: AgentCrewStatus | "working" | "done"): string {
  if (status === "working") return "live";
  if (status === "done") return "done";
  return "idle";
}

function groupBySpecialist(nodes: AgentCrewInstance[]) {
  const order: string[] = [];
  const grouped = new Map<string, AgentCrewInstance[]>();
  for (const node of nodes) {
    if (!grouped.has(node.specialist)) {
      order.push(node.specialist);
      grouped.set(node.specialist, []);
    }
    grouped.get(node.specialist)!.push(node);
  }
  return order.map((specialist) => ({
    specialist,
    name: specialistDisplayName(specialist),
    live: grouped.get(specialist)!.filter((item) => item.status === "working").length,
    nodes: grouped.get(specialist)!,
  }));
}

function CrewBranch({ node, last }: { node: AgentCrewInstance; last?: boolean }) {
  const nested = groupBySpecialist(node.children);
  return (
    <div className="relative pl-4">
      <span className={cn("absolute left-0 top-0 w-px bg-border", last ? "h-[11px]" : "bottom-0")} />
      <span className="absolute left-0 top-[10px] h-px w-3 bg-border" />
      <div className="flex items-start gap-2 min-w-0">
        <StatusDot status={node.status} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[12px] font-medium text-foreground truncate">{node.name}</span>
            {node.status === "working" ? (
              <Loader2 className="size-3 animate-spin text-primary shrink-0" />
            ) : null}
            <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
              {statusLabel(node.status)}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground truncate leading-snug">{node.label}</p>
          {node.status === "working" && node.lastAction ? (
            <p className="text-[10px] text-primary/80 truncate">{node.lastAction}</p>
          ) : null}
        </div>
      </div>
      {nested.length ? (
        <div className="mt-1.5 space-y-1.5">
          {nested.map((group, groupIndex) => (
            <TypeGroup
              key={group.specialist}
              group={group}
              last={groupIndex === nested.length - 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TypeGroup({
  group,
  last,
}: {
  group: { specialist: string; name: string; live: number; nodes: AgentCrewInstance[] };
  last?: boolean;
}) {
  if (group.nodes.length === 1) {
    return <CrewBranch node={group.nodes[0]!} last={last} />;
  }
  return (
    <div className="relative pl-4">
      <span className={cn("absolute left-0 top-0 w-px bg-border", last ? "h-[11px]" : "bottom-0")} />
      <span className="absolute left-0 top-[10px] h-px w-3 bg-border" />
      <div className="flex items-center gap-1.5 min-w-0">
        <StatusDot status={group.live > 0 ? "working" : "done"} />
        <span className="text-[12px] font-medium text-foreground">{group.name}</span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {group.live > 0 ? `${group.live}/${group.nodes.length}` : group.nodes.length}
        </span>
      </div>
      <div className="mt-1.5 space-y-1.5">
        {group.nodes.map((node, index) => (
          <CrewBranch key={node.id} node={node} last={index === group.nodes.length - 1} />
        ))}
      </div>
    </div>
  );
}

export function AgentCrewPanel({ run }: { run?: AgentRun }) {
  const events = run?.events ?? [];
  const crew = buildAgentCrew(events, run?.status);
  const live = crew.orchestratorStatus === "working" || crew.live > 0;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between px-1">
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Agents</div>
        <span
          className={cn(
            "text-[10px] font-medium tabular-nums",
            live ? "text-primary" : "text-muted-foreground",
          )}
        >
          {crew.live} live · {crew.total} launched
        </span>
      </div>

      {crew.types.length ? (
        <div className="flex flex-wrap gap-1 px-1">
          {crew.types.map((type) => (
            <span
              key={type.specialist}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                type.live > 0
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-muted/40 text-muted-foreground",
              )}
            >
              {type.name}
              <span className="tabular-nums">
                {type.live > 0 ? `${type.live}/${type.total}` : type.total}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="rounded-xl border border-border/80 bg-card/60 p-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Bot className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-semibold text-foreground">Orchestrator</span>
              <StatusDot status={crew.orchestratorStatus} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {crew.orchestratorStatus === "working"
                ? crew.live
                  ? `Routing ${crew.live} specialist${crew.live === 1 ? "" : "s"}`
                  : "Working"
                : crew.total
                  ? `${crew.total} specialist${crew.total === 1 ? "" : "s"} this turn`
                  : "Waiting for a run"}
            </p>
          </div>
        </div>

        {crew.children.length ? (
          <div className="mt-2 ml-3 space-y-1.5">
            {groupBySpecialist(crew.children).map((group, index, list) => (
              <TypeGroup key={group.specialist} group={group} last={index === list.length - 1} />
            ))}
          </div>
        ) : (
          <p className="mt-2 ml-8 text-[11px] text-muted-foreground leading-relaxed">
            Subagents show up here as a tree when the orchestrator delegates.
          </p>
        )}
      </div>
    </div>
  );
}
