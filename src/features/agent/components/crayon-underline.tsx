import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

export type SpecialistCrayonTheme = {
  strokeClass: string;
  primaryPath: string;
  secondaryPath: string;
};

/**
 * Hand-drawn, organic crayon/marker underline paths.
 * Carefully crafted to:
 * 1. NOT be straight (has natural organic dip, tilt, and hand sweep).
 * 2. NOT be curly (no loops, corkscrews, or scalloped waves).
 * 3. Feature dual-trace crayon wax friction (primary stroke + soft companion trace).
 * 4. Provide a unique handwritten gesture for every specialist.
 */
const CRAYON_VARIANTS: Record<string, SpecialistCrayonTheme> = {
  planner: {
    strokeClass: "text-blue-500 dark:text-blue-400",
    // Smooth natural arc dipping gently in middle-right with a soft taper
    primaryPath: "M 2 6.5 C 24 9.5, 52 9.0, 78 6.5 C 88 5.5, 93 4.8, 98 5.2",
    secondaryPath: "M 3 7.8 C 26 10.2, 54 9.8, 76 7.4 C 86 6.4, 91 5.6, 97 6.0",
  },
  researcher: {
    strokeClass: "text-violet-500 dark:text-violet-400",
    // Confident sweeping underline with slight start dip and soft upward bow
    primaryPath: "M 2 7.2 C 22 5.4, 48 5.8, 72 7.2 C 82 7.8, 91 7.0, 98 5.8",
    secondaryPath: "M 4 8.2 C 23 6.6, 49 6.8, 71 8.2 C 81 8.7, 89 7.8, 96 6.8",
  },
  builder: {
    strokeClass: "text-amber-500 dark:text-amber-400",
    // Warm crayon stroke with natural human hand inflection
    primaryPath: "M 2 6.0 C 26 8.8, 54 8.5, 76 6.0 C 85 5.0, 92 5.5, 98 6.0",
    secondaryPath: "M 3 7.2 C 28 9.8, 55 9.4, 75 7.0 C 84 6.0, 90 6.4, 97 6.9",
  },
  git: {
    strokeClass: "text-emerald-500 dark:text-emerald-400",
    // Slightly rising hand stroke with organic level-off
    primaryPath: "M 2 8.0 C 24 7.8, 52 5.8, 76 5.5 C 86 5.4, 92 6.2, 98 6.8",
    secondaryPath: "M 4 8.9 C 25 8.7, 51 6.8, 74 6.5 C 84 6.3, 90 7.0, 96 7.6",
  },
  tester: {
    strokeClass: "text-cyan-500 dark:text-cyan-400",
    // Gentle natural bowl curve like a quick pen gesture
    primaryPath: "M 2 5.2 C 26 7.8, 52 9.0, 78 7.5 C 86 6.8, 92 5.6, 98 5.0",
    secondaryPath: "M 3 6.4 C 27 8.8, 53 9.9, 77 8.5 C 85 7.8, 90 6.6, 97 6.0",
  },
  reviewer: {
    strokeClass: "text-indigo-500 dark:text-indigo-400",
    // Subtle organic wave, soft left-to-right hand sweep
    primaryPath: "M 2 6.8 C 22 5.5, 48 7.0, 74 7.8 C 84 8.0, 92 7.0, 98 5.8",
    secondaryPath: "M 4 7.8 C 23 6.7, 49 8.0, 73 8.7 C 83 8.9, 90 7.8, 96 6.8",
  },
  ops: {
    strokeClass: "text-rose-500 dark:text-rose-400",
    // Expressive downward bow with soft natural finish
    primaryPath: "M 2 6.0 C 28 8.8, 58 8.2, 80 6.2 C 88 5.4, 93 5.0, 98 5.5",
    secondaryPath: "M 3 7.2 C 29 9.8, 57 9.2, 78 7.2 C 86 6.4, 91 6.0, 97 6.4",
  },
  security: {
    strokeClass: "text-red-500 dark:text-red-400",
    // Firm, confident crayon underline with subtle center inflection
    primaryPath: "M 2 7.0 C 25 6.2, 54 7.5, 78 7.2 C 86 7.0, 93 6.0, 98 5.2",
    secondaryPath: "M 3 8.1 C 26 7.2, 55 8.4, 77 8.1 C 85 7.8, 91 6.8, 97 6.1",
  },
  orchestrator: {
    strokeClass: "text-sky-500 dark:text-sky-400",
    primaryPath: "M 2 6.2 C 24 8.6, 52 8.8, 76 6.8 C 86 5.8, 92 5.2, 98 5.6",
    secondaryPath: "M 3 7.4 C 26 9.6, 54 9.8, 75 7.8 C 84 6.8, 90 6.2, 97 6.6",
  },
  workflow: {
    strokeClass: "text-teal-500 dark:text-teal-400",
    primaryPath: "M 2 7.0 C 25 5.8, 52 6.8, 75 7.4 C 85 7.6, 92 6.8, 98 5.6",
    secondaryPath: "M 4 8.0 C 26 6.8, 53 7.8, 74 8.4 C 84 8.6, 90 7.8, 96 6.6",
  },
};

const DEFAULT_VARIANT: SpecialistCrayonTheme = {
  strokeClass: "text-primary/70",
  primaryPath: "M 2 6.2 C 25 8.5, 55 8.5, 78 6.5 C 87 5.5, 93 5.0, 98 5.4",
  secondaryPath: "M 3 7.4 C 27 9.5, 56 9.5, 77 7.5 C 86 6.5, 91 6.0, 97 6.4",
};

export function getSpecialistCrayonTheme(specialist?: string): SpecialistCrayonTheme {
  if (!specialist) return DEFAULT_VARIANT;
  const key = specialist.toLowerCase().trim();
  return CRAYON_VARIANTS[key] || DEFAULT_VARIANT;
}

export interface CrayonUnderlineProps extends SVGProps<SVGSVGElement> {
  specialist?: string;
  colorClass?: string;
  strokeWidth?: number;
}

/**
 * Renders a handwritten SaaS-style crayon underline for specialist names.
 * - Organic, non-straight curvature
 * - Not curly (clean hand-drawn arc/swoop)
 * - Different vibrant color & unique stroke variation for each specialist
 */
export function CrayonUnderline({
  specialist,
  colorClass,
  strokeWidth = 2.4,
  className,
  ...props
}: CrayonUnderlineProps) {
  const theme = getSpecialistCrayonTheme(specialist);
  const resolvedColorClass = colorClass || theme.strokeClass;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 12"
      fill="none"
      preserveAspectRatio="none"
      className={cn(
        "pointer-events-none absolute -bottom-[4px] left-0 h-[6px] w-full overflow-visible",
        resolvedColorClass,
        className,
      )}
      {...props}
    >
      {/* Primary crayon stroke */}
      <path
        d={theme.primaryPath}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="opacity-95"
      />
      {/* Subtle secondary trace mimicking crayon wax texture / friction */}
      <path
        d={theme.secondaryPath}
        stroke="currentColor"
        strokeWidth={Math.max(1, strokeWidth * 0.5)}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="opacity-40"
      />
    </svg>
  );
}
