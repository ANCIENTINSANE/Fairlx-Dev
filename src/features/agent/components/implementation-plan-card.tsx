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
        "rounded-xl border border-border/80 bg-card/80 p-3 shadow-2xs",
        compact ? "p-2.5" : "p-3",
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Plan</p>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          {model.percent}% · {model.status}
        </p>
      </div>
      <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{model.markdown}</ReactMarkdown>
      </div>
    </div>
  );
}
