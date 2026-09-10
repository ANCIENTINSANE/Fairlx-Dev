import {
  DEEPSEEK_FLASH_MODEL_ID,
  DEEPSEEK_PRO_MODEL_ID,
  FOUNDRY_CLAUDE_OPUS_MODEL_ID,
  FOUNDRY_CLAUDE_SONNET_MODEL_ID,
  FOUNDRY_GPT54_MODEL_ID,
  FOUNDRY_GPT55_MODEL_ID,
  FOUNDRY_GPT_LUNA_MODEL_ID,
  FOUNDRY_GPT_SOL_MODEL_ID,
  GROK_46_MODEL_ID,
} from "../constants";
import type { AgentAiConfigStored, AgentModel, AgentSpecialistId } from "../types";
import { conversationLooksLikeError, conversationLooksLikeInspect, conversationWantsBuildOrChange } from "./implementation-plan";

/**
 * Fairlx Router — picks the best available model for the job.
 *
 * Two contracts:
 *  - Manual mode (user picked a model): every role (orchestrator, worker, builder, reviewer,
 *    every specialist) uses exactly that model. The router never overrides a pinned choice.
 *  - Auto mode: the router classifies the turn into a task, scores every enabled model on
 *    that task and picks the winner. Short chatty turns go to the fastest model so replies
 *    feel instant; design/coding/review go to the strongest model for that skill.
 */

export type RouterTask =
  | "quick_chat"
  | "inspect"
  | "planning"
  | "design"
  | "coding"
  | "debug"
  | "review"
  | "research"
  | "reasoning";

export type RouterRole = "orchestrator" | "worker" | "builder" | "reviewer";

/** 1 (weak) … 5 (best-in-class). `speed` 5 = fastest / cheapest. */
export type ModelStrengths = {
  speed: number;
  coding: number;
  design: number;
  reasoning: number;
  review: number;
  research: number;
};

export type RouteDecision = {
  modelId: string;
  displayName: string;
  task: RouterTask;
  role: RouterRole;
  /** True when the user pinned a model and the router simply honoured it. */
  pinned: boolean;
  reason: string;
  score: number;
};

export const ROUTER_TASK_LABEL: Record<RouterTask, string> = {
  quick_chat: "quick answer",
  inspect: "repo inspection",
  planning: "planning",
  design: "design & UI",
  coding: "coding",
  debug: "debugging",
  review: "code review",
  research: "research",
  reasoning: "deep reasoning",
};

const KNOWN_STRENGTHS: Record<string, ModelStrengths> = {
  [DEEPSEEK_FLASH_MODEL_ID]: { speed: 5, coding: 3, design: 2, reasoning: 3, review: 2, research: 3 },
  [DEEPSEEK_PRO_MODEL_ID]: { speed: 3, coding: 4, design: 3, reasoning: 4, review: 3, research: 4 },
  [GROK_46_MODEL_ID]: { speed: 4, coding: 3, design: 3, reasoning: 4, review: 3, research: 5 },
  [FOUNDRY_GPT_LUNA_MODEL_ID]: { speed: 3, coding: 4, design: 4, reasoning: 4, review: 5, research: 4 },
  [FOUNDRY_GPT54_MODEL_ID]: { speed: 3, coding: 4, design: 3, reasoning: 4, review: 4, research: 4 },
  [FOUNDRY_GPT55_MODEL_ID]: { speed: 2, coding: 5, design: 4, reasoning: 5, review: 4, research: 4 },
  [FOUNDRY_GPT_SOL_MODEL_ID]: { speed: 2, coding: 5, design: 4, reasoning: 5, review: 4, research: 4 },
  [FOUNDRY_CLAUDE_SONNET_MODEL_ID]: { speed: 3, coding: 5, design: 5, reasoning: 4, review: 4, research: 4 },
  [FOUNDRY_CLAUDE_OPUS_MODEL_ID]: { speed: 1, coding: 5, design: 5, reasoning: 5, review: 5, research: 4 },
};

/** Heuristic strengths for BYOK models we have never seen, keyed off their id/name. */
export function inferModelStrengths(model: Pick<AgentModel, "id" | "modelId" | "displayName">): ModelStrengths {
  const known = KNOWN_STRENGTHS[model.id];
  if (known) return known;
  const name = `${model.id} ${model.modelId} ${model.displayName}`.toLowerCase();
  const fast = /\b(flash|mini|nano|lite|haiku|turbo|fast|small|8b|7b|3b)\b/.test(name);
  const top = /\b(opus|pro|ultra|sol|max|large|405b|70b|o1|o3|thinking|reason)\b/.test(name);
  const claude = /claude|sonnet|opus/.test(name);
  const base: ModelStrengths = { speed: 3, coding: 3, design: 3, reasoning: 3, review: 3, research: 3 };
  if (fast) return { ...base, speed: 5, coding: 2, design: 2, reasoning: 2, review: 2 };
  if (top) return { ...base, speed: 2, coding: 5, design: claude ? 5 : 4, reasoning: 5, review: 5, research: 4 };
  if (claude) return { ...base, coding: 5, design: 5, review: 4 };
  return base;
}

const DESIGN_RE =
  /\b(design|ui|ux|landing page|layout|theme|colou?r|palette|typography|css|tailwind|animation|responsive|hero section|figma|wireframe|mockup|beautiful|look(s)? (good|nice|cool)|style|styling|3d|logo|brand)\b/i;
const CODING_RE =
  /\b(implement|build|code|refactor|migrate|add (a |an )?(feature|endpoint|route|component|page|hook|test)|write (a |the )?(function|class|module|script|test)|fix the (bug|test|build)|scaffold|integrate|api|schema|database|typescript|react|next\.?js|node|python|sql|deploy|docker)\b/i;
const DEBUG_RE =
  /\b(debug|why (is|does|isn't|doesn't)|not working|broken|crash(es|ed)?|stack ?trace|exception|error|fails?|failing|bug|regression|500|404|undefined is not|cannot read propert)\b/i;
const REVIEW_RE = /\b(review|audit|security|vulnerab|lint|code quality|best practices?|smell|pr review|pull request review)\b/i;
const RESEARCH_RE =
  /\b(research|compare|comparison|which (library|framework|tool|approach)|pros and cons|trade-?offs?|options|alternatives|latest|docs|documentation|look up|search the web|find out)\b/i;
const PLANNING_RE =
  /\b(plan|roadmap|milestones?|phases?|break (it |this )?down|steps? to|architecture|architect|strategy|estimate|scope|spec|requirements?|prd)\b/i;
const REASONING_RE =
  /\b(prove|derive|analy[sz]e deeply|complex|tricky|edge cases?|concurrency|race condition|distributed|algorithm|optimi[sz]e|performance|big-?o|math|formal)\b/i;

const QUICK_MAX_WORDS = 18;

/** Classify a user turn into a router task. */
export function classifyRouterTask(text: string, options?: { planAccepted?: boolean }): { task: RouterTask; reason: string } {
  const source = (text || "").trim();
  const q = source.toLowerCase();
  const words = q.split(/\s+/).filter(Boolean).length;
  if (!q) return { task: "quick_chat", reason: "empty turn" };

  if (conversationLooksLikeError(source) || DEBUG_RE.test(q)) {
    return { task: "debug", reason: "looks like an error or a broken behaviour" };
  }
  if (REVIEW_RE.test(q)) return { task: "review", reason: "asks for review or audit" };
  if (DESIGN_RE.test(q)) return { task: "design", reason: "mentions design, UI or visual polish" };
  if (conversationLooksLikeInspect(source)) return { task: "inspect", reason: "asks about the repo" };
  if (conversationWantsBuildOrChange(source) || CODING_RE.test(q)) {
    if (!options?.planAccepted && PLANNING_RE.test(q)) return { task: "planning", reason: "coding request that starts with a plan" };
    return { task: "coding", reason: options?.planAccepted ? "plan accepted, implementation work" : "code change requested" };
  }
  if (PLANNING_RE.test(q)) return { task: "planning", reason: "asks for a plan or architecture" };
  if (RESEARCH_RE.test(q)) return { task: "research", reason: "asks to compare or look things up" };
  if (REASONING_RE.test(q)) return { task: "reasoning", reason: "needs careful multi-step reasoning" };
  if (words <= QUICK_MAX_WORDS && !/```/.test(source)) return { task: "quick_chat", reason: "short conversational turn" };
  return { task: "reasoning", reason: "long open-ended request" };
}

/** How much each strength matters for a given task. Weights sum to ~1. */
const TASK_WEIGHTS: Record<RouterTask, Partial<Record<keyof ModelStrengths, number>>> = {
  quick_chat: { speed: 0.8, reasoning: 0.2 },
  inspect: { speed: 0.7, research: 0.15, reasoning: 0.15 },
  planning: { reasoning: 0.5, coding: 0.3, speed: 0.2 },
  design: { design: 0.6, coding: 0.3, speed: 0.1 },
  coding: { coding: 0.6, reasoning: 0.3, speed: 0.1 },
  debug: { reasoning: 0.4, coding: 0.4, speed: 0.2 },
  review: { review: 0.6, coding: 0.3, reasoning: 0.1 },
  research: { research: 0.6, reasoning: 0.2, speed: 0.2 },
  reasoning: { reasoning: 0.7, coding: 0.2, speed: 0.1 },
};

const ROLE_TASK: Record<Exclude<RouterRole, "orchestrator">, RouterTask> = {
  worker: "quick_chat",
  builder: "coding",
  reviewer: "review",
};

export function scoreModelForTask(model: AgentModel, task: RouterTask): number {
  const strengths = inferModelStrengths(model);
  const weights = TASK_WEIGHTS[task];
  let score = 0;
  for (const [key, weight] of Object.entries(weights) as Array<[keyof ModelStrengths, number]>) {
    score += strengths[key] * weight;
  }
  // Tool calling is mandatory for anything that acts; penalise models without it.
  if (task !== "quick_chat" && model.toolCalling === false) score -= 2;
  return Math.round(score * 100) / 100;
}

function enabledModels(stored: AgentAiConfigStored): AgentModel[] {
  return stored.models.filter((model) => model.isEnabled);
}

export function isPinnedModelMode(stored: Pick<AgentAiConfigStored, "mode" | "selectedModelId">): boolean {
  return stored.mode === "manual" && Boolean(stored.selectedModelId);
}

/** Pick the best model for a task from the enabled catalog (auto mode). */
export function pickModelForTask(stored: AgentAiConfigStored, task: RouterTask): { model: AgentModel; score: number } | null {
  const candidates = enabledModels(stored);
  if (!candidates.length) return null;
  let best: { model: AgentModel; score: number } | null = null;
  for (const model of candidates) {
    const score = scoreModelForTask(model, task);
    if (!best || score > best.score) {
      best = { model, score };
      continue;
    }
    // Tie-break: the faster model wins so the user waits less for the same quality.
    if (score === best.score && inferModelStrengths(model).speed > inferModelStrengths(best.model).speed) {
      best = { model, score };
    }
  }
  return best;
}

/**
 * Decide which model a role should use for this turn.
 * `userText` is only consulted for the orchestrator; other roles have a fixed task.
 */
export function routeModel(
  stored: AgentAiConfigStored,
  input: { role: RouterRole; userText?: string; planAccepted?: boolean; specialist?: AgentSpecialistId },
): RouteDecision {
  const role = input.role;
  const classified =
    role === "orchestrator"
      ? classifyRouterTask(input.userText || "", { planAccepted: input.planAccepted })
      : { task: ROLE_TASK[role], reason: `${role} role` };

  if (isPinnedModelMode(stored)) {
    const pinned = stored.models.find((model) => model.id === stored.selectedModelId);
    return {
      modelId: stored.selectedModelId!,
      displayName: pinned?.displayName || stored.selectedModelId!,
      task: classified.task,
      role,
      pinned: true,
      reason: `You pinned ${pinned?.displayName || stored.selectedModelId}; Fairlx Router uses it for every role.`,
      score: pinned ? scoreModelForTask(pinned, classified.task) : 0,
    };
  }

  // Builder work before the plan is accepted is exploration — keep it on the fast lane.
  const task: RouterTask =
    role === "builder" && input.planAccepted === false ? "inspect" : classified.task;
  const picked = pickModelForTask(stored, task);
  if (!picked) {
    return {
      modelId: "",
      displayName: "",
      task,
      role,
      pinned: false,
      reason: "No enabled models.",
      score: 0,
    };
  }
  return {
    modelId: picked.model.id,
    displayName: picked.model.displayName,
    task,
    role,
    pinned: false,
    reason: `Fairlx Router picked ${picked.model.displayName} for ${ROUTER_TASK_LABEL[task]} (${classified.reason}).`,
    score: picked.score,
  };
}

/** Human summary for the chat / status strip. */
export function describeRouteDecision(decision: RouteDecision): string {
  if (decision.pinned) return `${decision.displayName} · pinned`;
  return `${decision.displayName} · ${ROUTER_TASK_LABEL[decision.task]}`;
}
