import {
  isPageTaskView,
  isPageUiActionName,
  type PageSnapshot,
  type PageTaskView,
  type PageUiActionName,
} from "./page-context";

export type ParsedPageUiAction = {
  action: PageUiActionName;
  view?: PageTaskView | string;
  zoom?: string;
  filters?: Record<string, string | null | undefined>;
  itemId?: string;
  path?: string;
};

export type PageUiParseResult =
  | { ok: true; value: ParsedPageUiAction }
  | { ok: false; error: string };

export type PageUiApplyResult = { ok: true; detail?: string } | { ok: false; error: string };

const ZOOM_ALIASES: Record<string, string> = {
  days: "TODAY",
  day: "TODAY",
  today: "TODAY",
  weeks: "WEEKS",
  week: "WEEKS",
  months: "MONTHS",
  month: "MONTHS",
  quarters: "QUARTERS",
  quarter: "QUARTERS",
};

export function normalizeZoom(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const upper = trimmed.toUpperCase();
  if (upper === "TODAY" || upper === "WEEKS" || upper === "MONTHS" || upper === "QUARTERS") return upper;
  return ZOOM_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

function readFilters(raw: unknown): Record<string, string | null | undefined> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const next: Record<string, string | null | undefined> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null) {
      next[key] = null;
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      next[key] = String(value);
    }
  }
  return Object.keys(next).length ? next : undefined;
}

export function parsePageUiAction(args: unknown): PageUiParseResult {
  let parsed: Record<string, unknown> = {};
  if (typeof args === "string") {
    try {
      const value = JSON.parse(args);
      if (value && typeof value === "object") parsed = value as Record<string, unknown>;
    } catch {
      return { ok: false, error: "page_ui arguments must be JSON." };
    }
  } else if (args && typeof args === "object") {
    parsed = args as Record<string, unknown>;
  } else {
    return { ok: false, error: "page_ui requires an action." };
  }

  const actionRaw = parsed.action ?? parsed.name ?? parsed.verb;
  if (!isPageUiActionName(actionRaw)) {
    return { ok: false, error: "Unknown page_ui action. Use set_view, set_zoom, set_filters, reset_filters, select_item, expand, collapse, or navigate." };
  }

  const viewRaw = parsed.view ?? parsed.taskView ?? parsed.tab;
  const view =
    typeof viewRaw === "string" && viewRaw.trim()
      ? isPageTaskView(viewRaw.trim().toLowerCase())
        ? viewRaw.trim().toLowerCase()
        : viewRaw.trim()
      : undefined;
  const zoom = normalizeZoom(parsed.zoom ?? parsed.zoomLevel);
  const itemIdRaw = parsed.itemId ?? parsed.id ?? parsed.workItemId ?? parsed.key;
  const itemId = typeof itemIdRaw === "string" ? itemIdRaw.trim() : undefined;
  const pathRaw = parsed.path ?? parsed.href ?? parsed.url;
  const path = typeof pathRaw === "string" ? pathRaw.trim() : undefined;
  const filters = readFilters(parsed.filters);

  if (actionRaw === "set_view" && !view) {
    return { ok: false, error: "set_view needs view (dashboard, table, kanban, calendar, timeline, backlog, or issues)." };
  }
  if (actionRaw === "set_zoom" && !zoom) {
    return { ok: false, error: "set_zoom needs zoom (days, weeks, months, or quarters)." };
  }
  if ((actionRaw === "select_item" || actionRaw === "expand" || actionRaw === "collapse") && !itemId) {
    return { ok: false, error: `${actionRaw} needs itemId (work item key or sprint id).` };
  }
  if (actionRaw === "navigate" && !path) {
    return { ok: false, error: "navigate needs an in-app path such as /workspaces/{id}/timeline." };
  }

  return {
    ok: true,
    value: {
      action: actionRaw,
      view,
      zoom,
      filters,
      itemId,
      path,
    },
  };
}

export function isSafeInAppPath(path: string, workspaceId?: string): boolean {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) return false;
  if (trimmed.startsWith("//")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  if (trimmed.includes("\\")) return false;
  const pathname = trimmed.split("?")[0] ?? trimmed;
  if (pathname.includes("..")) return false;
  if (!workspaceId) return true;
  if (pathname.includes(`/workspaces/${workspaceId}`)) return true;
  return /^\/(agent|profile|organization|onboarding|welcome)(\/|$)/.test(pathname);
}

export function pageUiActionSupported(snapshot: PageSnapshot | undefined, action: PageUiActionName): boolean {
  if (action === "navigate") return true;
  return Boolean(snapshot?.actions?.includes(action));
}

export function pageUiEventTitle(action: ParsedPageUiAction): string {
  if (action.action === "set_view") return `Switch view to ${action.view}`;
  if (action.action === "set_zoom") return `Set zoom to ${action.zoom}`;
  if (action.action === "set_filters") return "Update page filters";
  if (action.action === "reset_filters") return "Reset page filters";
  if (action.action === "select_item") return `Select ${action.itemId}`;
  if (action.action === "expand") return `Expand ${action.itemId}`;
  if (action.action === "collapse") return `Collapse ${action.itemId}`;
  if (action.action === "navigate") return `Open ${action.path}`;
  return "Update the open page";
}
