export type SidebarTone = {
  text: string;
  soft: string;
  bg: string;
  card: string;
  border: string;
  bar: string;
  icon: string;
  dot: string;
};

export const SIDEBAR_TONES = {
  sky: {
    text: "text-sky-700 dark:text-sky-300",
    soft: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-500/10",
    card: "bg-sky-500/[0.07] border-sky-500/20",
    border: "border-sky-500/25",
    bar: "bg-sky-500",
    icon: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
  },
  blue: {
    text: "text-blue-700 dark:text-blue-300",
    soft: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/10",
    card: "bg-blue-500/[0.07] border-blue-500/20",
    border: "border-blue-500/25",
    bar: "bg-blue-500",
    icon: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  violet: {
    text: "text-violet-700 dark:text-violet-300",
    soft: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-500/10",
    card: "bg-violet-500/[0.07] border-violet-500/20",
    border: "border-violet-500/25",
    bar: "bg-violet-500",
    icon: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    dot: "bg-violet-500",
  },
  indigo: {
    text: "text-indigo-700 dark:text-indigo-300",
    soft: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-500/10",
    card: "bg-indigo-500/[0.07] border-indigo-500/20",
    border: "border-indigo-500/25",
    bar: "bg-indigo-500",
    icon: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
    dot: "bg-indigo-500",
  },
  amber: {
    text: "text-amber-800 dark:text-amber-300",
    soft: "text-amber-700 dark:text-amber-400",
    bg: "bg-amber-500/10",
    card: "bg-amber-500/[0.08] border-amber-500/25",
    border: "border-amber-500/30",
    bar: "bg-amber-500",
    icon: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  emerald: {
    text: "text-emerald-700 dark:text-emerald-300",
    soft: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    card: "bg-emerald-500/[0.07] border-emerald-500/20",
    border: "border-emerald-500/25",
    bar: "bg-emerald-500",
    icon: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  cyan: {
    text: "text-cyan-700 dark:text-cyan-300",
    soft: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-500/10",
    card: "bg-cyan-500/[0.07] border-cyan-500/20",
    border: "border-cyan-500/25",
    bar: "bg-cyan-500",
    icon: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
    dot: "bg-cyan-500",
  },
  teal: {
    text: "text-teal-700 dark:text-teal-300",
    soft: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-500/10",
    card: "bg-teal-500/[0.07] border-teal-500/20",
    border: "border-teal-500/25",
    bar: "bg-teal-500",
    icon: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
    dot: "bg-teal-500",
  },
  rose: {
    text: "text-rose-700 dark:text-rose-300",
    soft: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-500/10",
    card: "bg-rose-500/[0.07] border-rose-500/20",
    border: "border-rose-500/25",
    bar: "bg-rose-500",
    icon: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    dot: "bg-rose-500",
  },
  red: {
    text: "text-red-700 dark:text-red-300",
    soft: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
    card: "bg-red-500/[0.07] border-red-500/20",
    border: "border-red-500/25",
    bar: "bg-red-500",
    icon: "bg-red-500/15 text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
} as const;

export type SidebarToneName = keyof typeof SIDEBAR_TONES;

const SPECIALIST_TONE: Record<string, SidebarToneName> = {
  orchestrator: "sky",
  planner: "blue",
  researcher: "violet",
  builder: "amber",
  git: "emerald",
  tester: "cyan",
  reviewer: "indigo",
  ops: "rose",
  security: "red",
  workflow: "teal",
};

export const TAB_TONES = {
  plan: "blue",
  context: "violet",
  changes: "emerald",
  terminal: "amber",
  preview: "cyan",
} as const;

export type WorkflowSidebarTab = keyof typeof TAB_TONES;

export function sidebarTone(name: SidebarToneName | string | undefined): SidebarTone {
  if (name && name in SIDEBAR_TONES) return SIDEBAR_TONES[name as SidebarToneName];
  return SIDEBAR_TONES.sky;
}

export function specialistTone(id?: string): SidebarTone {
  return sidebarTone(SPECIALIST_TONE[id || ""] || "violet");
}

export function tabTone(tab: WorkflowSidebarTab): SidebarTone {
  return sidebarTone(TAB_TONES[tab]);
}
