"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import type { ImplementationPlan } from "../types";
import { planPanelModel } from "../lib/implementation-plan";

export function ImplementationPlanCard({
  plan,
  compact,
}: {
  plan?: ImplementationPlan | null;
  compact?: boolean;
}) {
  const model = planPanelModel(plan);
  if (!model) return null;
  return (
    <div
      className={cn(
        "rounded-lg border border-sidebar-border bg-sidebar-accent/30",
        compact ? "p-2.5" : "p-3",
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">Plan</p>
        <p className="text-[11px] tabular-nums text-sidebar-foreground/50">
          {model.percent}% · {model.status}
        </p>
      </div>
      <div className="mb-3 h-1 overflow-hidden rounded-full bg-sidebar-border">
        <div
          className="h-full rounded-full bg-primary/70 transition-all"
          style={{ width: `${Math.min(100, Math.max(0, model.percent))}%` }}
        />
      </div>
      <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{model.markdown}</ReactMarkdown>
      </div>
    </div>
  );
}
