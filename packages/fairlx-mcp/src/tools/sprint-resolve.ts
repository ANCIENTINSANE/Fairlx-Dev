import { invalidParams, notFoundError } from "../protocol/errors";
import type { McpRuntime } from "../runtime/types";
import { listAllDocuments } from "./helpers";

export const STORY_POINT_DAYS = 0.5;

export function documentSprintId(doc: Record<string, unknown>): string {
  if (doc.sprintId == null) return "";
  const value = String(doc.sprintId).trim();
  if (!value || value === "null" || value === "undefined") return "";
  return value;
}

export function sprintOrdinal(name: string): number | undefined {
  const match = name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .match(/^sprint\s+(\d+)\b/);
  return match ? Number(match[1]) : undefined;
}

export function sprintNameMatches(name: string, query: string): boolean {
  const n = name.toLowerCase().replace(/\s+/g, " ").trim();
  const q = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (!n || !q) return false;
  if (n === q) return true;
  const numbered = q.match(/^(?:sprint\s+)?(\d+)$/);
  if (numbered) return sprintOrdinal(n) === Number(numbered[1]);
  if (n.startsWith(q) && (n.length === q.length || /[\s—–-]/.test(n[q.length] ?? ""))) return true;
  return false;
}

export function sprintDocumentId(doc: Record<string, unknown>): string {
  return String(doc.$id ?? doc.id ?? "").trim();
}

function parseDay(iso: string): Date | null {
  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function workingDaysBetween(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const from = parseDay(start);
  const to = parseDay(end);
  if (!from || !to || to < from) return null;
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  let days = 0;
  while (cur <= last) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) days += 1;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

export function estimatedBuildDays(storyPoints: number | null | undefined): number | null {
  if (storyPoints == null || !Number.isFinite(storyPoints) || storyPoints < 0) return null;
  return Math.round(storyPoints * STORY_POINT_DAYS * 10) / 10;
}

export type SprintPlanStats = {
  itemCount: number;
  storyPoints: number;
  estimatedBuildDays: number | null;
  workingDays: number | null;
  fits: boolean | null;
};

export type CompactSprint = {
  id: string;
  name: string;
  status: string;
  goal: string;
  startDate: string | null;
  endDate: string | null;
  workingDays: number | null;
  itemCount: number;
  storyPoints: number;
  estimatedBuildDays: number | null;
  fits: boolean | null;
};

export function compactSprint(
  doc: Record<string, unknown>,
  stats?: Partial<SprintPlanStats>,
): CompactSprint {
  const startDate = optionalDate(doc.startDate);
  const endDate = optionalDate(doc.endDate);
  const workingDays = stats?.workingDays ?? workingDaysBetween(startDate, endDate);
  const itemCount = stats?.itemCount ?? 0;
  const storyPoints = stats?.storyPoints ?? 0;
  const estimated = stats?.estimatedBuildDays ?? estimatedBuildDays(storyPoints > 0 ? storyPoints : null);
  const fits =
    stats?.fits ??
    (estimated != null && workingDays != null ? estimated <= workingDays : null);
  return {
    id: sprintDocumentId(doc),
    name: String(doc.name ?? "").trim(),
    status: String(doc.status ?? "PLANNED"),
    goal: String(doc.goal ?? ""),
    startDate,
    endDate,
    workingDays,
    itemCount,
    storyPoints,
    estimatedBuildDays: estimated,
    fits,
  };
}

function optionalDate(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text && text !== "null" && text !== "undefined" ? text : null;
}

export function planStatsForItems(
  sprint: Record<string, unknown>,
  items: Record<string, unknown>[],
): SprintPlanStats {
  const storyPoints = items.reduce((sum, item) => {
    const points = Number(item.storyPoints);
    return sum + (Number.isFinite(points) && points > 0 ? points : 0);
  }, 0);
  const workingDays = workingDaysBetween(optionalDate(sprint.startDate), optionalDate(sprint.endDate));
  const estimated = estimatedBuildDays(storyPoints > 0 ? storyPoints : null);
  return {
    itemCount: items.length,
    storyPoints,
    estimatedBuildDays: estimated,
    workingDays,
    fits: estimated != null && workingDays != null ? estimated <= workingDays : null,
  };
}

export function findMatchingSprints(
  docs: Record<string, unknown>[],
  query: string,
): Record<string, unknown>[] {
  return docs.filter((doc) => sprintNameMatches(String(doc.name ?? ""), query));
}

export function createdAtMs(doc: Record<string, unknown>): number {
  const raw = Date.parse(String(doc.$createdAt ?? ""));
  return Number.isFinite(raw) ? raw : 0;
}

export function pickCanonicalSprint(matches: Record<string, unknown>[]): Record<string, unknown> | undefined {
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];
  const active = matches.filter((doc) => String(doc.status ?? "").toUpperCase() === "ACTIVE");
  const pool = active.length > 0 ? active : matches;
  return [...pool].sort((left, right) => createdAtMs(left) - createdAtMs(right))[0];
}

export function findSprintForCreate(
  docs: Record<string, unknown>[],
  name: string,
): Record<string, unknown> | undefined {
  const matches = docs.filter((doc) => {
    const existing = String(doc.name ?? "");
    return sprintNameMatches(existing, name) || sprintNameMatches(name, existing);
  });
  if (matches.length === 0) return undefined;
  const normalized = name.toLowerCase().replace(/\s+/g, " ").trim();
  const exact = matches.filter(
    (doc) => String(doc.name ?? "").toLowerCase().replace(/\s+/g, " ").trim() === normalized,
  );
  if (exact.length === 1) return exact[0];
  const ordinal = sprintOrdinal(name);
  if (ordinal !== undefined) {
    const byOrdinal = matches.filter((doc) => sprintOrdinal(String(doc.name ?? "")) === ordinal);
    const canonical = pickCanonicalSprint(byOrdinal);
    if (canonical) return canonical;
  }
  return pickCanonicalSprint(matches);
}

export function sprintsWithSameNumber(
  docs: Record<string, unknown>[],
  sprint: Record<string, unknown>,
): Record<string, unknown>[] {
  const id = sprintDocumentId(sprint);
  const ordinal = sprintOrdinal(String(sprint.name ?? ""));
  if (ordinal === undefined) return [];
  return docs.filter((doc) => {
    if (sprintDocumentId(doc) === id) return false;
    return sprintOrdinal(String(doc.name ?? "")) === ordinal;
  });
}

function formatSprintChoices(matches: Record<string, unknown>[]): string {
  return matches
    .map((doc) => {
      const name = String(doc.name ?? "").trim() || "Sprint";
      const id = sprintDocumentId(doc);
      return id ? `${name} (id: ${id})` : name;
    })
    .filter(Boolean)
    .join(", ");
}

async function isProjectId(runtime: McpRuntime, query: string): Promise<string | null> {
  if (!runtime.collections.projects) return null;
  try {
    const project = await runtime.store.get<Record<string, unknown>>(
      runtime.collections.projects,
      query,
    );
    const name = String(project.name ?? "").trim();
    return name || "this project";
  } catch {
    return null;
  }
}

export async function resolveSprintId(
  runtime: McpRuntime,
  projectId: string,
  raw: string,
): Promise<string> {
  const sprint = await loadSprint(runtime, raw, { projectId });
  return sprintDocumentId(sprint);
}

export async function resolveOptionalSprintId(
  runtime: McpRuntime,
  projectId: string,
  raw: unknown,
): Promise<string | null> {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  if (!value || value === "null" || value === "undefined") return null;
  return resolveSprintId(runtime, projectId, value);
}

export async function loadSprint(
  runtime: McpRuntime,
  raw: string,
  options?: { projectId?: string },
): Promise<Record<string, unknown>> {
  const query = raw.trim();
  if (!query) throw invalidParams("sprintId is required");
  const projectId = options?.projectId?.trim() || "";

  try {
    const sprint = await runtime.store.get<Record<string, unknown>>(
      runtime.collections.sprints,
      query,
    );
    if (!projectId || String(sprint.projectId ?? "") === projectId) {
      return sprint;
    }
  } catch {
    // Resolve by sprint name / number next.
  }

  if (projectId && query === projectId) {
    throw invalidParams(
      'sprintId is this project\'s id. Pass a sprint name like "Sprint 1" or the sprint id from fairlx_sprint_list — never the project id.',
    );
  }

  const projectName = await isProjectId(runtime, query);
  if (projectName) {
    throw invalidParams(
      `sprintId is a project id (${projectName}). Pass a sprint name like "Sprint 1" or the sprint id from fairlx_sprint_list — never the project id.`,
    );
  }

  if (!projectId) {
    throw notFoundError(
      `Sprint not found: ${query}. Pass projectId with a sprint name like "Sprint 1", or pass the sprint id from fairlx_sprint_list. Never pass the project id.`,
    );
  }

  const docs = await listAllDocuments(runtime, runtime.collections.sprints, [
    { type: "equal", field: "projectId", value: projectId },
  ]);
  const matches = findMatchingSprints(docs, query);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    const canonical = pickCanonicalSprint(matches);
    if (canonical) return canonical;
    throw invalidParams(
      `Several sprints match "${query}": ${formatSprintChoices(matches)}. Pass one of those ids. Do not create another sprint with the same number — update the existing one.`,
    );
  }
  throw notFoundError(
    `Sprint not found: ${query}. Call fairlx_sprint_list for this project and pass a sprint name or id. Never pass the project id.`,
  );
}

export async function listProjectSprints(
  runtime: McpRuntime,
  projectId: string,
): Promise<Record<string, unknown>[]> {
  return listAllDocuments(runtime, runtime.collections.sprints, [
    { type: "equal", field: "projectId", value: projectId },
  ]);
}

export function sprintNameMap(sprints: Record<string, unknown>[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const sprint of sprints) {
    const id = sprintDocumentId(sprint);
    const name = String(sprint.name ?? "").trim();
    if (id && name) map.set(id, name);
  }
  return map;
}

export function itemsForSprint(
  items: Record<string, unknown>[],
  sprint: Record<string, unknown>,
): Record<string, unknown>[] {
  const id = sprintDocumentId(sprint);
  const name = String(sprint.name ?? "");
  return items.filter((item) => {
    const sprintId = documentSprintId(item);
    if (!sprintId) return false;
    return sprintId === id || sprintNameMatches(name, sprintId) || sprintId === name;
  });
}
