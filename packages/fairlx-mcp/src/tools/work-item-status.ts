export type WorkflowStatusRef = {
  key?: string;
  name?: string;
};

const STATUS_ALIASES: Record<string, string> = {
  todo: "TODO",
  "to do": "TODO",
  backlog: "TODO",
  assigned: "ASSIGNED",
  "in progress": "IN_PROGRESS",
  doing: "IN_PROGRESS",
  "in review": "IN_REVIEW",
  review: "IN_REVIEW",
  done: "DONE",
  complete: "DONE",
  completed: "DONE",
};

export function foldStatusLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+column$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map "Assigned column" / "assigned" to the Kanban status key ASSIGNED. */
export function resolveWorkItemStatus(raw: string, workflowStatuses: WorkflowStatusRef[] = []): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const folded = foldStatusLabel(trimmed);
  const fromWorkflow = workflowStatuses.find((status) => {
    const key = String(status.key ?? "");
    const name = String(status.name ?? "");
    return (
      key.toLowerCase() === trimmed.toLowerCase() ||
      foldStatusLabel(key) === folded ||
      foldStatusLabel(name) === folded
    );
  });
  if (fromWorkflow?.key) return String(fromWorkflow.key);
  return STATUS_ALIASES[folded] || trimmed;
}
