"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Eye,
  FlaskConical,
  GitBranch,
  Hammer,
  Mail,
  Map,
  Search,
  Shield,
  Workflow,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  specialistTone,
  type SidebarTone,
  type SidebarToneName,
  sidebarTone,
} from "../lib/sidebar-theme";

const SPECIALIST_ICONS: Record<string, LucideIcon> = {
  orchestrator: Bot,
  planner: Map,
  researcher: Search,
  builder: Hammer,
  git: GitBranch,
  tester: FlaskConical,
  reviewer: Eye,
  ops: Mail,
  security: Shield,
  workflow: Workflow,
};

export function SidebarIconWell({
  icon: Icon,
  tone,
  className,
  iconClassName,
}: {
  icon: LucideIcon;
  tone: SidebarTone | SidebarToneName;
  className?: string;
  iconClassName?: string;
}) {
  const resolved = typeof tone === "string" ? sidebarTone(tone) : tone;
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-lg",
        resolved.icon,
        className,
      )}
    >
      <Icon className={cn("size-3.5", iconClassName)} />
    </span>
  );
}

export function SpecialistGlyph({
  specialist,
  live,
  className,
}: {
  specialist: string;
  live?: boolean;
  className?: string;
}) {
  const tone = specialistTone(specialist);
  const Icon = SPECIALIST_ICONS[specialist] || Bot;
  return (
    <span className={cn("relative shrink-0", className)}>
      <SidebarIconWell icon={Icon} tone={tone} className="size-7" />
      {live ? (
        <span className="absolute -right-0.5 -top-0.5 flex size-2.5">
          <span className="absolute inset-0 rounded-full bg-emerald-400/70 animate-ping" />
          <span className="relative size-2.5 rounded-full border border-background bg-emerald-500" />
        </span>
      ) : null}
    </span>
  );
}

export function StatusPill({
  kind,
  children,
  className,
}: {
  kind: "live" | "idle" | "done" | "warn" | "danger" | "info" | "neutral";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold capitalize tabular-nums",
        kind === "live" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        kind === "done" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        kind === "idle" && "bg-muted text-muted-foreground",
        kind === "warn" && "bg-amber-500/15 text-amber-800 dark:text-amber-300",
        kind === "danger" && "bg-rose-500/15 text-rose-700 dark:text-rose-300",
        kind === "info" && "bg-sky-500/15 text-sky-700 dark:text-sky-300",
        kind === "neutral" && "bg-muted/80 text-muted-foreground",
        className,
      )}
    >
      {kind === "live" ? <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" /> : null}
      {children}
    </span>
  );
}

export function SidebarSection({
  icon,
  tone,
  title,
  action,
  children,
  className,
}: {
  icon: LucideIcon;
  tone: SidebarTone | SidebarToneName;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2.5", className)}>
      <div className="flex items-center gap-2 px-0.5">
        <SidebarIconWell icon={icon} tone={tone} className="size-6 rounded-md" iconClassName="size-3" />
        <h3 className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/80">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SidebarEmptyState({
  icon: Icon,
  tone,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  tone: SidebarTone | SidebarToneName;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const resolved = typeof tone === "string" ? sidebarTone(tone) : tone;
  return (
    <div className={cn("flex flex-col items-center rounded-xl border px-4 py-6 text-center", resolved.card)}>
      <SidebarIconWell icon={Icon} tone={resolved} className="mb-3 size-10 rounded-xl" iconClassName="size-5" />
      <p className="text-[13px] font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-[16rem] text-[11px] leading-relaxed text-muted-foreground">{children}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function MetricTile({
  label,
  value,
  hint,
  live,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  live?: boolean;
  tone: SidebarTone | SidebarToneName;
}) {
  const resolved = typeof tone === "string" ? sidebarTone(tone) : tone;
  return (
    <div className={cn("rounded-xl border px-2.5 py-2", resolved.card)}>
      <p className={cn("text-[10px] font-semibold uppercase tracking-wider", resolved.text)}>{label}</p>
      <p className={cn("mt-1 text-[13px] font-semibold leading-5 break-words", live ? resolved.text : "text-foreground")}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function AccentCard({
  tone,
  className,
  children,
}: {
  tone: SidebarTone | SidebarToneName;
  className?: string;
  children: ReactNode;
}) {
  const resolved = typeof tone === "string" ? sidebarTone(tone) : tone;
  return (
    <div className={cn("relative overflow-hidden rounded-xl border bg-card/80", resolved.border, className)}>
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", resolved.bar)} />
      <div className="pl-[3px]">{children}</div>
    </div>
  );
}
