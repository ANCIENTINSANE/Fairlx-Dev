import type { AgentSessionMode } from "../types";

/**
 * Mode router — reads the user's words and picks the session mode the agent should adopt.
 *
 * Used when the harness session mode is `auto`. The detected mode is injected into the
 * turn (`[Session mode: plan · auto]`) so the model follows that mode's instructions, and
 * the UI shows which mode the router chose.
 */

export type ResolvedSessionMode = Exclude<AgentSessionMode, "auto" | "multitask">;

export type ModeDecision = {
  mode: ResolvedSessionMode;
  /** 0–1. Below 0.5 the router is guessing; the UI shows a softer chip. */
  confidence: number;
  reason: string;
  /** Short hints the agent can act on before the user is asked anything. */
  hints: string[];
};

const DEBUG_RE =
  /\b(debug|why (is|does|isn't|doesn't|won't|can't)|not working|doesn't work|broken|crash(es|ed|ing)?|stack ?trace|traceback|exception|error|fails?|failing|failed|bug|regression|undefined is not|cannot read propert|500|404|hydration|reproduce|flaky)\b/i;
const ERROR_DUMP_RE = /(TypeError|ReferenceError|SyntaxError|RangeError):\s|Failed to compile|Unhandled Runtime Error|^\s*at\s+\S+\s+\(/m;

const PLAN_RE =
  /\b(plan|roadmap|milestones?|phases?|break (it |this |that )?down|steps? (to|for)|architecture|architect|strategy|estimate|scope|spec(ification)?|requirements?|prd|proposal|how (should|would|could) (i|we)|approach|design doc|outline|before (we|i) (build|start|code))\b/i;
const BUILD_RE =
  /\b(build|create|make|implement|ship|scaffold|set ?up|start (a|the|my|our)? ?(project|product|app|website|site|api|service|startup)|i (just )?want to (build|create|make|start)|new (project|product|app|website|saas|tool))\b/i;
const ASK_RE =
  /^(what|who|when|where|which|how many|how much|is|are|does|do|did|can|could|should|explain|tell me|describe|summari[sz]e|list|show me|define)\b/i;
const ACTION_RE =
  /\b(create|update|delete|assign|unassign|remove|move|close|rename|add|change|edit|write|fix|refactor|deploy|run|install|implement|build|make|generate|send|open|merge|commit|push)\b/i;
const PERSONAL_RE =
  /\b(personal agent|chief of staff|stand ?in for me|on my behalf|as me|my (voice|style|persona)|delegate (this|it|the work) to (planner|builder|researcher|specialists?)|orchestrate|coordinate (the )?(team|specialists|sub-?agents)|multi-?agent|crew)\b/i;

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Guess a product name & stack when the user says "I want to build X" without details. */
export function buildHints(text: string): string[] {
  const hints: string[] = [];
  const t = text.toLowerCase();
  if (/\b(mobile|ios|android|app store|play store)\b/.test(t)) hints.push("Assume a mobile app (React Native / Expo) unless told otherwise.");
  else if (/\b(api|backend|service|microservice|server)\b/.test(t)) hints.push("Assume a TypeScript backend (Hono/Node) with a Postgres-style store.");
  else if (/\b(website|landing|portfolio|blog|marketing)\b/.test(t)) hints.push("Assume a Next.js site with Tailwind; ship a landing page first.");
  else if (/\b(saas|dashboard|product|startup|platform|tool)\b/.test(t)) hints.push("Assume a Next.js + TypeScript web app with auth, a dashboard and a billing stub.");
  else if (BUILD_RE.test(t)) hints.push("Assume a Next.js + TypeScript web app; propose the name and stack instead of asking.");
  if (BUILD_RE.test(t) && !/\bnamed?\b|\bcall(ed)? it\b/.test(t)) {
    hints.push("Propose a working project name from the idea; the user can rename later.");
  }
  return hints;
}

/** Decide the session mode from the latest user text. */
export function detectSessionMode(text: string, options?: { hasProject?: boolean; hasRepo?: boolean }): ModeDecision {
  const source = (text || "").trim();
  if (!source) return { mode: "agent", confidence: 0.3, reason: "empty turn", hints: [] };
  const count = words(source);

  if (ERROR_DUMP_RE.test(source) || /```[\s\S]*(error|exception|trace)[\s\S]*```/i.test(source)) {
    return { mode: "debug", confidence: 0.95, reason: "pasted an error or stack trace", hints: ["Reproduce first, then isolate the failing path."] };
  }
  if (PERSONAL_RE.test(source)) {
    return { mode: "personal", confidence: 0.85, reason: "asks the personal agent / crew to act", hints: [] };
  }
  if (DEBUG_RE.test(source) && !/\b(plan|roadmap)\b/i.test(source)) {
    return { mode: "debug", confidence: 0.8, reason: "describes something broken", hints: ["Ask for the exact error only if it is not already in the message."] };
  }
  if (PLAN_RE.test(source)) {
    const hints = buildHints(source);
    return {
      mode: "plan",
      confidence: 0.85,
      reason: "asks for a plan, approach or architecture",
      hints: hints.length ? hints : ["Write the plan with phases and tasks; do not edit code yet."],
    };
  }
  if (BUILD_RE.test(source) && (!options?.hasRepo || count <= 14)) {
    // "I want to build a product" with nothing connected: plan first, pre-answer the obvious questions.
    return {
      mode: "plan",
      confidence: options?.hasRepo ? 0.6 : 0.8,
      reason: options?.hasRepo ? "new build request" : "new build request with no repo connected",
      hints: [
        ...buildHints(source),
        "Do not interrogate. State assumptions, then present the plan with 2–3 choices only where a decision truly blocks.",
      ],
    };
  }
  if (ASK_RE.test(source) && !ACTION_RE.test(source) && count <= 40) {
    return { mode: "ask", confidence: 0.75, reason: "a question, no action requested", hints: [] };
  }
  if (ACTION_RE.test(source)) {
    return { mode: "agent", confidence: 0.7, reason: "asks for an action", hints: [] };
  }
  if (count <= 6) return { mode: "ask", confidence: 0.5, reason: "short message", hints: [] };
  return { mode: "agent", confidence: 0.5, reason: "default", hints: [] };
}

export const MODE_ROUTE_TAG_RE = /^\[Session mode: ([a-z]+)( · auto)?\]/i;

/** Read back the mode a message was sent with plus whether Fairlx picked it automatically. */
export function sessionModeTagFromContent(content: string): { mode: ResolvedSessionMode; auto: boolean } | null {
  const firstLine = (content || "").split("\n").find((line) => line.trim().length > 0) || "";
  const match = firstLine.match(MODE_ROUTE_TAG_RE);
  if (!match) return null;
  const mode = match[1].toLowerCase();
  if (mode === "agent" || mode === "plan" || mode === "debug" || mode === "ask" || mode === "personal") {
    return { mode, auto: Boolean(match[2]) };
  }
  return null;
}

/** Read back the mode a message was sent with (works for auto-routed and pinned modes). */
export function sessionModeFromContent(content: string): ResolvedSessionMode | null {
  return sessionModeTagFromContent(content)?.mode ?? null;
}
