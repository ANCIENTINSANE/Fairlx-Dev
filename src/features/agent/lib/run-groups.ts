export const UNGROUPED_PROJECT_ID = "";

export type RunProjectGroup<T extends { id: string; projectId?: string; updatedAt: string }> = {
  projectId: string;
  projectName: string;
  runs: T[];
};

export function groupRunsByProject<T extends { id: string; projectId?: string; updatedAt: string }>(
  runs: T[],
  projects: Array<{ id: string; name: string }>,
): RunProjectGroup<T>[] {
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const buckets = new Map<string, T[]>();
  for (const run of runs) {
    const key = run.projectId?.trim() || UNGROUPED_PROJECT_ID;
    const list = buckets.get(key);
    if (list) list.push(run);
    else buckets.set(key, [run]);
  }
  const groups: RunProjectGroup<T>[] = [];
  for (const [projectId, grouped] of buckets) {
    groups.push({
      projectId,
      projectName: projectId ? names.get(projectId) || "Project" : "No project",
      runs: grouped,
    });
  }
  groups.sort((a, b) => {
    const aTime = a.runs[0]?.updatedAt ?? "";
    const bTime = b.runs[0]?.updatedAt ?? "";
    if (aTime !== bTime) return bTime.localeCompare(aTime);
    if (a.projectId && !b.projectId) return -1;
    if (!a.projectId && b.projectId) return 1;
    return a.projectName.localeCompare(b.projectName);
  });
  return groups;
}

export function groupContainingRun<T extends { id: string }>(
  groups: Array<{ projectId: string; runs: T[] }>,
  runId: string,
): string | undefined {
  return groups.find((group) => group.runs.some((run) => run.id === runId))?.projectId;
}
