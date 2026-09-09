export const PAGE_CONTEXT_START = "[Current page]";
export const PAGE_CONTEXT_END = "[/Current page]";
export const PAGE_CONTEXT_MAX_CHARS = 8_000;

export const PAGE_UI_ACTIONS = [
  "set_view",
  "set_zoom",
  "set_filters",
  "reset_filters",
  "select_item",
  "expand",
  "collapse",
  "navigate",
] as const;

export type PageUiActionName = (typeof PAGE_UI_ACTIONS)[number];

export const PAGE_TASK_VIEWS = [
  "dashboard",
  "table",
  "kanban",
  "calendar",
  "timeline",
  "backlog",
  "issues",
] as const;

export type PageTaskView = (typeof PAGE_TASK_VIEWS)[number];

export type PageSnapshotRegion = {
  id: string;
  position: "nav" | "header" | "main" | "main-left" | "main-right" | "details" | "overlay";
  label: string;
  summary?: string;
};

export type PageSnapshotEntity = {
  kind: string;
  id: string;
  key?: string;
  title: string;
  status?: string;
  location?: string;
  extra?: string;
};

export type PageSnapshot = {
  page: string;
  pathname: string;
  search?: string;
  heading?: string;
  workspaceId?: string;
  projectId?: string;
  layout?: PageSnapshotRegion[];
  entities?: PageSnapshotEntity[];
  ui?: Record<string, string | number | boolean | null | undefined>;
  actions?: PageUiActionName[];
};

const PAGE_BLOCK_RE = /\[Current page\][\s\S]*?\[\/Current page\]\s*/g;

const TASK_VIEW_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  table: "Table",
  kanban: "Kanban",
  calendar: "Calendar",
  timeline: "Timeline",
  backlog: "Backlog",
  issues: "Issues",
};

export function isPageUiActionName(value: unknown): value is PageUiActionName {
  return typeof value === "string" && (PAGE_UI_ACTIONS as readonly string[]).includes(value);
}

export function isPageTaskView(value: unknown): value is PageTaskView {
  return typeof value === "string" && (PAGE_TASK_VIEWS as readonly string[]).includes(value);
}

/** Strip org-slug prefix so /acme/workspaces/... matches /workspaces/... */
export function normalizeDashboardPath(pathname: string): string {
  const trimmed = pathname.trim() || "/";
  const withoutOrg = trimmed.replace(/^\/[^/]+(?=\/workspaces\/)/, "");
  return withoutOrg || trimmed;
}

export function searchParam(search: string | undefined, key: string): string | undefined {
  if (!search) return undefined;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  try {
    const value = new URLSearchParams(raw).get(key);
    return value?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function labelDashboardPage(pathname: string, search?: string): string {
  const path = normalizeDashboardPath(pathname);
  const view = searchParam(search, "task-view");
  const viewLabel = view ? TASK_VIEW_LABELS[view] : undefined;

  if (/\/workspaces\/[^/]+\/projects\/[^/]+\/backlog(?:\/|$)/.test(path)) return "Project backlog";
  if (/\/workspaces\/[^/]+\/projects\/[^/]+\/sprints(?:\/|$)/.test(path)) return "Project sprints";
  if (/\/workspaces\/[^/]+\/projects\/[^/]+\/docs(?:\/|$)/.test(path)) return "Project docs";
  if (/\/workspaces\/[^/]+\/projects\/[^/]+\/members(?:\/|$)/.test(path)) return "Project members";
  if (/\/workspaces\/[^/]+\/projects\/[^/]+\/teams(?:\/|$)/.test(path)) return "Project teams";
  if (/\/workspaces\/[^/]+\/projects\/[^/]+\/settings(?:\/|$)/.test(path)) return "Project settings";
  if (/\/workspaces\/[^/]+\/projects\/[^/]+\/github/.test(path)) return "Project GitHub";
  if (/\/workspaces\/[^/]+\/projects\/[^/]+\/workflow/.test(path)) return "Project workflow";
  if (/\/workspaces\/[^/]+\/projects\/[^/]+$/.test(path) || /\/workspaces\/[^/]+\/projects\/[^/]+\/?$/.test(path)) {
    if (viewLabel === "Timeline") return "Project timeline";
    if (viewLabel) return `Project ${viewLabel.toLowerCase()}`;
    return "Project dashboard";
  }
  if (/\/workspaces\/[^/]+\/timeline(?:\/|$)/.test(path)) return "Timeline";
  if (/\/workspaces\/[^/]+\/tasks\/[^/]+/.test(path)) return "Work item";
  if (/\/workspaces\/[^/]+\/tasks(?:\/|$)/.test(path)) {
    if (viewLabel === "Timeline") return "My Spaces timeline";
    if (viewLabel) return `My Spaces · ${viewLabel}`;
    return "My Spaces";
  }
  if (/\/workspaces\/[^/]+\/programs\/[^/]+/.test(path)) return "Program";
  if (/\/workspaces\/[^/]+\/programs(?:\/|$)/.test(path)) return "Programs";
  if (/\/workspaces\/[^/]+\/time-tracking(?:\/|$)/.test(path)) return "Time tracking";
  if (/\/workspaces\/[^/]+\/settings(?:\/|$)/.test(path)) return "Workspace settings";
  if (/\/workspaces\/[^/]+\/members(?:\/|$)/.test(path)) return "Workspace members";
  if (/\/workspaces\/[^/]+\/billing(?:\/|$)/.test(path)) return "Billing";
  if (/\/workspaces\/[^/]+\/audit-logs(?:\/|$)/.test(path)) return "Audit log";
  if (/\/workspaces\/[^/]+\/spaces(?:\/|$)/.test(path)) return "Spaces";
  if (/\/workspaces\/[^/]+\/my-backlog(?:\/|$)/.test(path)) return "My backlog";
  if (/\/workspaces\/[^/]+\/rewards(?:\/|$)/.test(path)) return "Rewards";
  if (/\/profile(?:\/|$)/.test(path)) return "Profile";
  if (/\/organization(?:\/|$)/.test(path)) return "Organization";
  if (/\/agent\//.test(path) || path === "/agent") return "Agent";
  if (/\/workspaces\/[^/]+$/.test(path)) return "Home";
  return "Fairlx";
}

export function defaultPageLayout(page: string): PageSnapshotRegion[] {
  return [
    { id: "nav", position: "nav", label: "Left app sidebar", summary: "Home, My Spaces, Programs, Timeline, Settings" },
    { id: "header", position: "header", label: "Top bar" },
    { id: "main", position: "main", label: page },
    { id: "agent", position: "overlay", label: "Floating fairlx Agent (this chat)" },
  ];
}

export function defaultPageSnapshot(input: {
  pathname: string;
  search?: string;
  workspaceId?: string;
  projectId?: string;
  heading?: string;
}): PageSnapshot {
  const page = labelDashboardPage(input.pathname, input.search);
  return {
    page,
    pathname: input.pathname,
    search: input.search || undefined,
    heading: input.heading,
    workspaceId: input.workspaceId || undefined,
    projectId: input.projectId || undefined,
    layout: defaultPageLayout(page),
    entities: [],
    ui: {},
    actions: ["navigate"],
  };
}

export function mergePageSnapshots(base: PageSnapshot, overlay?: Partial<PageSnapshot> | null): PageSnapshot {
  if (!overlay) return base;
  const ui = { ...(base.ui ?? {}), ...(overlay.ui ?? {}) };
  const actions = Array.from(new Set([...(base.actions ?? []), ...(overlay.actions ?? [])]));
  return {
    page: overlay.page || base.page,
    pathname: overlay.pathname || base.pathname,
    search: overlay.search ?? base.search,
    heading: overlay.heading || base.heading,
    workspaceId: overlay.workspaceId || base.workspaceId,
    projectId: overlay.projectId || base.projectId,
    layout: overlay.layout?.length ? overlay.layout : base.layout,
    entities: overlay.entities ?? base.entities,
    ui,
    actions,
  };
}

function clip(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

function formatUi(ui: PageSnapshot["ui"]): string {
  if (!ui) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(ui)) {
    if (value == null || value === "" || value === false) continue;
    parts.push(`${key}=${value}`);
  }
  return parts.join("; ");
}

const MAX_ENTITIES = 48;

export function formatPageSnapshot(snapshot: PageSnapshot, maxChars = PAGE_CONTEXT_MAX_CHARS - 40): string {
  const allEntities = snapshot.entities ?? [];
  const omitted = Math.max(0, allEntities.length - MAX_ENTITIES);
  const entities =
    omitted > 0
      ? [
          ...allEntities.slice(0, MAX_ENTITIES),
          { kind: "note", id: "omitted", title: `${omitted} more items omitted` },
        ]
      : allEntities;
  const lines: string[] = [`Page: ${snapshot.page}`];
  const url = `${snapshot.pathname}${snapshot.search || ""}`;
  if (url) lines.push(`URL: ${url}`);
  if (snapshot.heading && snapshot.heading !== snapshot.page) lines.push(`Heading: ${clip(snapshot.heading, 120)}`);
  if (snapshot.workspaceId) lines.push(`workspaceId: ${snapshot.workspaceId}`);
  if (snapshot.projectId) lines.push(`projectId: ${snapshot.projectId}`);

  if (snapshot.layout?.length) {
    lines.push("Layout:");
    for (const region of snapshot.layout) {
      const extra = region.summary ? ` — ${clip(region.summary, 220)}` : "";
      lines.push(`- ${region.position}: ${region.label}${extra}`);
    }
  }

  const ui = formatUi(snapshot.ui);
  if (ui) lines.push(`UI: ${ui}`);

  if (entities.length) {
    lines.push("Visible:");
    for (const entity of entities) {
      const name = entity.key || entity.id;
      const status = entity.status ? ` ${entity.status}` : "";
      const where = entity.location ? ` @ ${clip(entity.location, 80)}` : "";
      const extra = entity.extra ? ` (${clip(entity.extra, 80)})` : "";
      lines.push(`- ${entity.kind} ${name} "${clip(entity.title, 80)}"${status}${where}${extra}`);
    }
  }

  if (snapshot.actions?.length) {
    lines.push(`Actions: ${snapshot.actions.join(", ")}`);
  }

  const body = lines.join("\n");
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars - 1)}…`;
}

export function formatPageContextBlock(snapshot?: PageSnapshot | null): string {
  if (!snapshot) return "";
  const body = formatPageSnapshot(snapshot);
  return `${PAGE_CONTEXT_START}\n${body}\n${PAGE_CONTEXT_END}`;
}

export function stripPageContext(content: string): string {
  return content.replace(PAGE_BLOCK_RE, "").trim();
}

export function hasPageContext(content: string): boolean {
  return content.includes(PAGE_CONTEXT_START);
}

export function attachPageContext(content: string, block?: string | null): string {
  const trimmedBlock = block?.trim();
  if (!trimmedBlock) return content;
  if (hasPageContext(content)) return content;
  const text = content.trim();
  return text ? `${trimmedBlock}\n${text}` : trimmedBlock;
}

export function keepLatestPageContext<T extends { role: string; content: string }>(messages: T[]): T[] {
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUser = index;
      break;
    }
  }
  return messages.map((message, index) => {
    if (message.role !== "user" || index === lastUser) return message;
    const stripped = stripPageContext(message.content);
    if (stripped === message.content) return message;
    return { ...message, content: stripped };
  });
}

export function chromePageLayout(page: string, extras: PageSnapshotRegion[] = []): PageSnapshotRegion[] {
  const chrome = defaultPageLayout(page);
  const nav = chrome.filter((region) => region.id === "nav" || region.id === "header");
  const agent = chrome.find((region) => region.id === "agent");
  return agent ? [...nav, ...extras, agent] : [...nav, ...extras];
}
