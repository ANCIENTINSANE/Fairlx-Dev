"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { AgentContextChip, AgentRun } from "../types";
import { useGetAgentHarness } from "../api/use-agent-harness";
import { useGetAgentContext } from "../api/use-agent-context";
import { useGetAgentAiConfig } from "../api/use-agent-ai-config";
import { useGetAgentMcpConfig } from "../api/use-agent-mcp-config";
import { useGetPersonalAgent } from "../api/use-personal-agent";
import { profileIsTrained } from "../lib/personal-agent-status";
import {
  calculateContextUsage,
  formatExactTokenCount,
  formatOccupancyHeader,
} from "../lib/context-meter";

interface AgentContextMeterProps {
  run?: AgentRun;
  draftPrompt?: string;
  chips?: AgentContextChip[];
  workspaceId?: string;
  projectId?: string;
  className?: string;
}

export function AgentContextMeter({
  run,
  draftPrompt = "",
  chips = [],
  workspaceId,
  projectId,
  className,
}: AgentContextMeterProps) {
  const [open, setOpen] = useState(false);
  const { data: harness } = useGetAgentHarness();
  const { data: context } = useGetAgentContext();
  const { data: ai } = useGetAgentAiConfig();
  const { data: mcp } = useGetAgentMcpConfig();
  const { data: personal } = useGetPersonalAgent();

  const personalPrompt =
    personal?.profile && profileIsTrained(personal.profile) ? personal.profile.compiledPrompt : undefined;

  const usage = useMemo(
    () =>
      calculateContextUsage({
        run,
        harness,
        context,
        ai,
        mcp,
        draftPrompt,
        chips,
        personalPrompt,
        modelId: run?.modelId,
        workspaceId,
        projectId,
      }),
    [run, harness, context, ai, mcp, draftPrompt, chips, personalPrompt, workspaceId, projectId],
  );

  const { totalTokens, maxTokens, percentFull, categories } = usage;
  const occupancyLabel = formatOccupancyHeader(totalTokens, maxTokens);

  const strokePercent = Math.min(100, Math.max(0, percentFull));
  const arcColor =
    percentFull >= 90
      ? "stroke-rose-500"
      : percentFull >= 75
        ? "stroke-amber-500"
        : "stroke-foreground/80 dark:stroke-zinc-200";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "size-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/70 flex items-center justify-center transition-colors cursor-pointer select-none relative",
            open && "bg-muted/80 text-foreground",
            className,
          )}
          title={`Context Usage: ${percentFull}% Full (${occupancyLabel} Tokens)`}
          aria-label="View context usage details"
        >
          <svg className="size-4 -rotate-90" viewBox="0 0 36 36">
            <path
              className="stroke-muted-foreground/25 dark:stroke-zinc-700"
              strokeWidth="3.5"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            {strokePercent > 0 ? (
              <path
                className={cn("transition-all duration-300", arcColor)}
                strokeDasharray={`${strokePercent}, 100`}
                strokeWidth="3.5"
                strokeLinecap="round"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            ) : null}
          </svg>
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-[340px] sm:w-[370px] p-4 bg-popover/95 dark:bg-zinc-900/95 backdrop-blur-md border border-border/80 dark:border-zinc-800 shadow-xl rounded-2xl text-popover-foreground z-50 select-none"
      >
        <div className="flex items-center justify-between pb-3">
          <span className="text-sm font-semibold text-foreground tracking-tight">
            Context Usage
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="size-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground pb-2">
          <span>{percentFull < 1 && totalTokens > 0 ? "< 1" : percentFull}% Full</span>
          <span>{occupancyLabel} Tokens</span>
        </div>

        <div className="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-800/90 overflow-hidden flex items-stretch">
          {categories.map((cat) => {
            if (cat.tokens <= 0) return null;
            const widthPct = maxTokens > 0 ? (cat.tokens / maxTokens) * 100 : 0;
            return (
              <div
                key={cat.id}
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: cat.color,
                }}
                className="h-full transition-all duration-300"
                title={`${cat.name}: ${formatExactTokenCount(cat.tokens)} tokens`}
              />
            );
          })}
        </div>

        <div className="pt-3 space-y-1.5">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center justify-between text-xs sm:text-[13px] py-0.5 group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="size-2.5 rounded-[2px] shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="text-foreground/90 font-normal truncate">
                  {cat.name}
                </span>
              </div>
              <span className="text-muted-foreground font-mono text-[12px] tabular-nums shrink-0 ml-2">
                {formatExactTokenCount(cat.tokens)}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
