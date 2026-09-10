import type { AgentContextChip, AgentSessionMode } from "../types";

/**
 * Composer `/` and `@` shortcuts. `/plan` `/build` `/preview` steer the turn;
 * `@builder` `@plan` `@sandbox` name who or what to use.
 */

export type ShortcutKind = "slash" | "at";

export type ComposerShortcut = {
  kind: ShortcutKind;
  /** Token without the leading / or @ */
  id: string;
  label: string;
  hint: string;
  /** Instruction injected into the stored user message for the model. */
  instruction: string;
  /** Force this session mode when the shortcut is used. */
  mode?: Exclude<AgentSessionMode, "auto" | "multitask">;
  chip?: Omit<AgentContextChip, "id"> & { id?: string };
};

export const SLASH_SHORTCUTS: ComposerShortcut[] = [
  {
    kind: "slash",
    id: "plan",
    label: "/plan",
    hint: "Draft or update an implementation plan",
    instruction:
      "Call submit_implementation_plan for THIS request. If an older accepted plan is leftover work, do not execute those phases — plan this slice instead.",
    mode: "plan",
  },
  {
    kind: "slash",
    id: "build",
    label: "/build",
    hint: "Implement in the Azure sandbox",
    instruction:
      "Implement this request in the coding session. Finish the current plan phase (or submit a short plan for this slice) before later phases.",
    mode: "agent",
  },
  {
    kind: "slash",
    id: "ask",
    label: "/ask",
    hint: "Answer without editing",
    instruction: "Ask mode: answer from context. Do not edit files or start a sandbox.",
    mode: "ask",
  },
  {
    kind: "slash",
    id: "debug",
    label: "/debug",
    hint: "Find the failure and fix it",
    instruction: "Debug mode: reproduce, isolate, then fix. Do not start a new product plan.",
    mode: "debug",
  },
  {
    kind: "slash",
    id: "preview",
    label: "/preview",
    hint: "Sandbox preview link",
    instruction: "Focus the sandbox preview: coding_session_status, then start or reboot if it is not live.",
  },
  {
    kind: "slash",
    id: "terminal",
    label: "/terminal",
    hint: "Show running sandbox commands",
    instruction: "Inspect coding_session_exec / terminal output in the sandbox. Summarize what is running.",
  },
  {
    kind: "slash",
    id: "mcp",
    label: "/mcp",
    hint: "Use connected MCP servers",
    instruction: "Use MCP tools the user has connected. Call mcp_list if you are unsure what is available.",
  },
  {
    kind: "slash",
    id: "skill",
    label: "/skill",
    hint: "Run a Fairlx skill",
    instruction: "Call use_skill. If the user did not name a skill, pick the closest enabled skill from the harness.",
  },
  {
    kind: "slash",
    id: "changes",
    label: "/changes",
    hint: "Show files changed in this run",
    instruction: "Summarize sandbox/git file changes for this run. Prefer git status / the Changes tree over guessing.",
  },
];

export const AT_SHORTCUTS: ComposerShortcut[] = [
  {
    kind: "at",
    id: "plan",
    label: "@plan",
    hint: "Current implementation plan",
    instruction:
      "Work from the current implementation plan. Complete the current phase this turn, or tell the user what is left and why. Do not skip to a later phase.",
  },
  {
    kind: "at",
    id: "builder",
    label: "@builder",
    hint: "Delegate to the builder",
    instruction: "Delegate this slice to the builder specialist (delegate_agent agent=builder).",
  },
  {
    kind: "at",
    id: "planner",
    label: "@planner",
    hint: "Delegate to the planner",
    instruction: "Delegate planning to the planner specialist. Call submit_implementation_plan.",
  },
  {
    kind: "at",
    id: "reviewer",
    label: "@reviewer",
    hint: "Delegate to the reviewer",
    instruction: "Delegate review to the reviewer specialist after the current phase is implemented.",
  },
  {
    kind: "at",
    id: "sandbox",
    label: "@sandbox",
    hint: "Azure coding session",
    instruction: "Use the bound Azure sandbox (coding_session_status / implement / exec). Reboot if it is stuck.",
  },
  {
    kind: "at",
    id: "github",
    label: "@github",
    hint: "GitHub repo tools",
    instruction: "Use GitHub tools for this project (list/read files, PR). Prefer the sandbox while one is bound.",
  },
  {
    kind: "at",
    id: "preview",
    label: "@preview",
    hint: "Live preview URL",
    instruction: "Open or repair the sandbox preview. Do not invent Azure hostnames.",
  },
];

export type ShortcutTrigger = {
  kind: ShortcutKind;
  query: string;
  start: number;
  end: number;
};

const TOKEN_RE = /(^|[\s])([/@])([a-zA-Z0-9_-]*)$/;

export function detectComposerTrigger(text: string, caret: number): ShortcutTrigger | null {
  const before = text.slice(0, Math.max(0, caret));
  const match = before.match(TOKEN_RE);
  if (!match) return null;
  const sigil = match[2]!;
  const query = match[3] || "";
  const start = before.length - sigil.length - query.length;
  return {
    kind: sigil === "/" ? "slash" : "at",
    query,
    start,
    end: caret,
  };
}

export function filterShortcuts(kind: ShortcutKind, query: string, extra: ComposerShortcut[] = []): ComposerShortcut[] {
  const catalog = kind === "slash" ? SLASH_SHORTCUTS : [...AT_SHORTCUTS, ...extra];
  const q = query.trim().toLowerCase();
  if (!q) return catalog;
  return catalog.filter(
    (item) => item.id.toLowerCase().startsWith(q) || item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q),
  );
}

export function applyShortcutAtCaret(
  text: string,
  caret: number,
  shortcut: ComposerShortcut,
): { text: string; caret: number } {
  const trigger = detectComposerTrigger(text, caret);
  if (!trigger) {
    const insert = `${shortcut.label} `;
    const next = `${text.slice(0, caret)}${insert}${text.slice(caret)}`;
    return { text: next, caret: caret + insert.length };
  }
  const insert = `${shortcut.label} `;
  const next = `${text.slice(0, trigger.start)}${insert}${text.slice(trigger.end)}`;
  return { text: next, caret: trigger.start + insert.length };
}

const SHORTCUT_LINE_RE = /^\[Shortcut [/@][^\]]+\][^\n]*$/;

export function stripComposerShortcuts(text: string): string {
  return (text || "")
    .split("\n")
    .filter((line) => !SHORTCUT_LINE_RE.test(line.trim()))
    .join("\n")
    .trim();
}

function lookupShortcut(kind: ShortcutKind, id: string, extraAt: ComposerShortcut[]): ComposerShortcut | undefined {
  const catalog = kind === "slash" ? SLASH_SHORTCUTS : [...AT_SHORTCUTS, ...extraAt];
  return catalog.find((item) => item.id.toLowerCase() === id.toLowerCase());
}

export function expandComposerShortcuts(
  text: string,
  extraAt: ComposerShortcut[] = [],
): { text: string; mode?: ComposerShortcut["mode"]; chips: AgentContextChip[] } {
  const source = text || "";
  const found: ComposerShortcut[] = [];
  const chips: AgentContextChip[] = [];
  const tokenRe = /(^|[\s])([/@])([a-zA-Z0-9_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(source))) {
    const kind: ShortcutKind = match[2] === "/" ? "slash" : "at";
    const hit = lookupShortcut(kind, match[3]!, extraAt);
    if (hit && !found.some((item) => item.kind === hit.kind && item.id === hit.id)) found.push(hit);
    if (hit?.chip) {
      chips.push({
        kind: hit.chip.kind,
        id: hit.chip.id || hit.id,
        label: hit.chip.label,
        meta: hit.chip.meta,
        content: hit.chip.content,
      });
    }
  }
  if (!found.length) return { text: source, chips };
  const cleaned = source
    .replace(/(^|[\s])([/@])([a-zA-Z0-9_-]+)/g, (full, lead: string, sigil: string, id: string) => {
      const kind: ShortcutKind = sigil === "/" ? "slash" : "at";
      return lookupShortcut(kind, id, extraAt) ? lead : full;
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  const lines = found.map((item) => `[Shortcut ${item.label}] ${item.instruction}`);
  return {
    text: [...lines, cleaned].filter(Boolean).join("\n"),
    mode: found.find((item) => item.mode)?.mode,
    chips,
  };
}

export function extraAtShortcutsFromContext(input: {
  skills?: Array<{ id: string; name: string; description?: string }>;
  projects?: Array<{ id: string; name: string }>;
  workItems?: Array<{ id: string; key?: string; title: string }>;
}): ComposerShortcut[] {
  const extra: ComposerShortcut[] = [];
  for (const skill of input.skills ?? []) {
    const id = skill.name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || skill.id.slice(0, 8);
    extra.push({
      kind: "at",
      id,
      label: `@${id}`,
      hint: skill.description || skill.name,
      instruction: `Call use_skill with skill "${skill.name}" (${skill.id}).`,
      chip: { kind: "skill", id: skill.id, label: skill.name, meta: skill.description },
    });
  }
  for (const project of (input.projects ?? []).slice(0, 8)) {
    const id = project.name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || project.id.slice(0, 8);
    extra.push({
      kind: "at",
      id,
      label: `@${id}`,
      hint: `Project ${project.name}`,
      instruction: `Scope this turn to project ${project.name}.`,
      chip: { kind: "project", id: project.id, label: project.name },
    });
  }
  for (const item of (input.workItems ?? []).slice(0, 8)) {
    const id = (item.key || item.title).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
    if (!id) continue;
    extra.push({
      kind: "at",
      id,
      label: `@${id}`,
      hint: item.title,
      instruction: `This turn is about work item ${item.key || item.title}.`,
      chip: { kind: "work_item", id: item.id, label: item.title, meta: item.key },
    });
  }
  return extra;
}
