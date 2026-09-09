"use client";

import { Bot, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AgentAiConfigPublic, AgentRun, AgentSessionMode } from "../types";
import { useGetAgentHarness } from "../api/use-agent-harness";
import { isPersonalSessionMode } from "../lib/session-context";
import { AgentFace, useAgentFaceMood } from "./agent-face";
import { CrayonUnderline } from "./crayon-underline";
import { crewModelHints } from "../lib/client-defaults";
import { formatTokenCount, formatUsd } from "../lib/run-usage";
import {
  buildAgentCrew,
  crewHeadlineCounts,
  specialistDisplayName,
  type AgentCrew,
  type AgentCrewActivity,
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

function compactClock(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function elapsedLabel(from?: string, until?: string): string | null {
  if (!from) return null;
  const start = new Date(from).getTime();
  const end = until ? new Date(until).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
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

function ActivityLog({ items }: { items: AgentCrewActivity[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border/70 bg-background px-2.5 py-2 space-y-2">
      {items.map((item) => (
        <div key={item.id} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2.5">
          <time className="pt-px text-[10px] leading-4 tabular-nums text-muted-foreground">
            {compactClock(item.at)}
          </time>
          <div className="min-w-0 overflow-hidden">
            <p className="text-[11px] leading-4 text-foreground break-all line-clamp-2">{item.title}</p>
            {item.detail ? (
              <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground break-words line-clamp-2">
                {item.detail}
              </p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function usageLine(calls: number, tokens: number, costUSD: number): string | null {
  if (!calls && !tokens) return null;
  const parts: string[] = [];
  if (calls) parts.push(`${calls} call${calls === 1 ? "" : "s"}`);
  if (tokens) parts.push(`${formatTokenCount(tokens)} tokens`);
  if (costUSD > 0) parts.push(formatUsd(costUSD));
  return parts.join(" · ");
}

function CrewBranch({ node }: { node: AgentCrewInstance }) {
  const nested = groupBySpecialist(node.children);
  const elapsed = elapsedLabel(node.startedAt, node.finishedAt || node.activity[node.activity.length - 1]?.at);
  const usage = usageLine(node.calls, node.tokens, node.costUSD);
  const liveAction = node.status === "working" ? node.currentAction || node.lastAction : undefined;
  return (
    <div className="relative min-w-0 pl-1">
      <span className="absolute -left-[15px] top-[7px]">
        <StatusDot status={node.status} />
      </span>
      <div className="min-w-0 space-y-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[12px] font-medium text-foreground truncate">{node.name}</span>
          {node.status === "working" ? (
            <Loader2 className="size-3 animate-spin text-primary shrink-0 translate-y-px" />
          ) : null}
          <span className="ml-auto flex items-baseline gap-1 shrink-0 text-[10px] text-muted-foreground">
            <span className="uppercase tracking-wide">{statusLabel(node.status)}</span>
            {elapsed ? <span className="tabular-nums lowercase">· {elapsed}</span> : null}
          </span>
        </div>
        <p className="text-[11px] leading-4 text-primary/90 truncate">{node.modelName}</p>
        <p className="text-[11px] leading-4 text-muted-foreground break-words line-clamp-2">{node.label}</p>
        {node.task && node.task !== node.label ? (
          <p className="text-[10px] leading-4 text-muted-foreground/90 break-words line-clamp-2">{node.task}</p>
        ) : null}
        {liveAction ? (
          <p className="text-[10px] leading-4 text-primary break-words line-clamp-2">Now: {liveAction}</p>
        ) : null}
        {usage ? <p className="text-[10px] leading-4 tabular-nums text-muted-foreground">{usage}</p> : null}
        <ActivityLog items={node.activity} />
        {nested.length ? (
          <div className="mt-2 ml-1 border-l border-border/80 pl-3 space-y-3">
            {nested.map((group) => (
              <TypeGroup key={group.specialist} group={group} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TypeGroup({
  group,
}: {
  group: { specialist: string; name: string; live: number; nodes: AgentCrewInstance[] };
}) {
  if (group.nodes.length === 1) {
    return <CrewBranch node={group.nodes[0]!} />;
  }
  return (
    <div className="space-y-3 min-w-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <StatusDot status={group.live > 0 ? "working" : "done"} />
        <span className="text-[12px] font-medium text-foreground">{group.name}</span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {group.live > 0 ? `${group.live}/${group.nodes.length}` : group.nodes.length}
        </span>
      </div>
      <div className="ml-1 border-l border-border/80 pl-3 space-y-3">
        {group.nodes.map((node) => (
          <CrewBranch key={node.id} node={node} />
        ))}
      </div>
    </div>
  );
}

function StatRow({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2">
      <span className="text-sidebar-foreground/55 shrink-0">{label}</span>
      <span className={cn("text-right font-medium leading-4 break-words", live ? "text-primary" : "text-sidebar-foreground")}>
        {value}
      </span>
    </div>
  );
}

function orchestratorCopy(crew: AgentCrew): string {
  if (crew.orchestratorStatus === "working") {
    if (crew.live === 1) return "Routing 1 specialist";
    if (crew.live > 1) return `Routing ${crew.live} specialists`;
    return crew.orchestratorAction || "Working";
  }
  if (crew.total === 1) return "1 specialist this turn";
  if (crew.total > 1) return `${crew.total} specialists this turn`;
  return crew.orchestratorStatus === "done" ? "Turn finished" : "Waiting for a run";
}

export function AgentCrewPanel({
  run,
  ai,
  sessionMode,
}: {
  run?: AgentRun;
  ai?: AgentAiConfigPublic;
  sessionMode?: AgentSessionMode;
}) {
  const { data: harness } = useGetAgentHarness();
  const isPersonal = isPersonalSessionMode(sessionMode ?? harness?.settings.sessionMode);
  const faceMood = useAgentFaceMood(run);
  const events = run?.events ?? [];
  const crew = buildAgentCrew(events, run?.status, crewModelHints(ai, run));
  const headline = crewHeadlineCounts(crew);
  const live = crew.orchestratorStatus === "working" || crew.live > 0;
  const orchUsage = usageLine(crew.orchestratorCalls, crew.orchestratorTokens, 0);
  const nestedValue =
    crew.nestedTotal > 0
      ? `${crew.nestedLive} live / ${crew.nestedTotal}`
      : "None yet";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-[11px] tracking-wider uppercase font-semibold text-sidebar-foreground/50">Agents</div>
        {live ? (
          <div className="flex items-center gap-1.5 text-[10px] text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full font-medium tabular-nums">
            <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
            {headline.live} live · {headline.launched} launched
          </div>
        ) : (
          <span className="text-[10px] font-medium tabular-nums text-sidebar-foreground/50">
            {headline.live} live · {headline.launched} launched
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-accent/30 text-[11px] divide-y divide-sidebar-border">
        <StatRow
          label={isPersonal ? "Personal Agent model" : "Orchestrator model"}
          value={crew.orchestratorModelName}
          live={crew.orchestratorStatus === "working"}
        />
        <StatRow label="Worker model" value={crew.workerModelName} />
        <StatRow
          label={isPersonal ? "Under personal agent" : "Under orchestrator"}
          value={`${crew.directLive} live / ${crew.directTotal}`}
          live={crew.directLive > 0}
        />
        <StatRow label="Nested sub-agents" value={nestedValue} live={crew.nestedLive > 0} />
        <div>
          <StatRow
            label="Parallel slots"
            value={`${crew.live}/${crew.parallelCap}`}
            live={crew.live > 0}
          />
          <div className="px-3 pb-2.5">
            <div className="h-1 overflow-hidden rounded-full bg-sidebar-border">
              <div
                className="h-full rounded-full bg-primary/70 transition-all"
                style={{ width: `${Math.min(100, (crew.live / Math.max(1, crew.parallelCap)) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {crew.types.length ? (
        <div className="flex flex-wrap gap-1.5 px-0.5">
          {crew.types.map((type) => (
            <span
              key={type.specialist}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium",
                type.live > 0
                  ? "border-primary/25 bg-primary/10 text-primary"
                  : "border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground/60",
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

      <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-3 overflow-hidden">
        <div className="flex items-start gap-2.5 min-w-0">
          {isPersonal ? (
            <AgentFace mood={faceMood} size={26} className="mt-0.5 shrink-0" />
          ) : (
            <div className="size-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="size-3.5" />
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[12px] font-semibold text-foreground truncate">
                {isPersonal ? "Personal Agent" : "Orchestrator"}
              </span>
              <StatusDot status={crew.orchestratorStatus} />
              {crew.orchestratorStatus === "working" ? (
                <Loader2 className="size-3 animate-spin text-primary shrink-0" />
              ) : null}
            </div>
            <p className="text-[11px] leading-4 text-primary/90 truncate">{crew.orchestratorModelName}</p>
            <p className="text-[11px] leading-4 text-muted-foreground">{orchestratorCopy(crew)}</p>
            {crew.orchestratorStatus === "working" && crew.orchestratorAction ? (
              <p className="text-[10px] leading-4 text-primary break-words line-clamp-2">Now: {crew.orchestratorAction}</p>
            ) : null}
            {orchUsage ? <p className="text-[10px] leading-4 tabular-nums text-muted-foreground">{orchUsage}</p> : null}
          </div>
        </div>

        <ActivityLog items={crew.orchestratorActivity} />

        {crew.children.length ? (
          <div className="mt-3 ml-3 border-l border-border/80 pl-3 space-y-3">
            {groupBySpecialist(crew.children).map((group) => (
              <TypeGroup key={group.specialist} group={group} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
            Sub-agents appear here when the {isPersonal ? "personal agent" : "orchestrator"} delegates. Workers use {crew.workerModelName}.
          </p>
        )}
      </div>

      <div>
        <div className="mb-1.5 px-1 text-[11px] tracking-wider uppercase font-semibold text-sidebar-foreground/50">
          Specialist roster
        </div>
        <div className="overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-accent/30 divide-y divide-sidebar-border">
          {crew.roster.map((item) => (
            <div key={item.specialist} className="flex items-start gap-2.5 px-3 py-2 min-w-0">
              <StatusDot status={item.live > 0 ? "working" : item.total > 0 ? "done" : "idle"} className="mt-1" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="relative inline-block max-w-full pb-0.5">
                    <span className="text-[12px] font-medium text-foreground truncate block">{item.name}</span>
                    <CrayonUnderline specialist={item.specialist} />
                  </span>
                  <span
                    className={cn(
                      "ml-auto text-[10px] tabular-nums shrink-0",
                      item.live > 0 ? "text-primary font-medium" : "text-sidebar-foreground/50",
                    )}
                  >
                    {item.live > 0 ? `${item.live} live` : item.total > 0 ? `${item.total} this turn` : "idle"}
                  </span>
                </div>
                <p className="text-[10px] leading-4 text-sidebar-foreground/55 line-clamp-2">
                  {item.modelName || crew.workerModelName} · {item.role}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
