import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Cross-tab / agent side-effect cache sync.
 *
 * MCP and other-tab writes update Appwrite + Redis, but each browser tab has
 * its own React Query client. Window-focus refetch is off globally (permissions
 * and nav must not hammer the API). This bus invalidates the screens that
 * actually changed.
 */

export const FAIRLX_SYNC_KINDS = [
  "projects",
  "work-items",
  "sprints",
  "docs",
  "comments",
  "time-logs",
  "members",
  "teams",
  "departments",
  "github",
  "webhooks",
  "saved-views",
  "notifications",
  "organizations",
  "workspaces",
  "spaces",
  "activity",
  "attachments",
  "agent-context",
] as const;

export type FairlxSyncKind = (typeof FAIRLX_SYNC_KINDS)[number];

export const FAIRLX_SYNC_QUERY_KEYS: Record<FairlxSyncKind, readonly QueryKey[]> = {
  projects: [
    ["projects"],
    ["project"],
    ["my-space-projects"],
    ["program-projects"],
    ["program-available-projects"],
  ],
  "work-items": [
    ["work-items"],
    ["work-item"],
    ["epics"],
    ["my-space-work-items"],
    ["project-analytics"],
    ["workspace-analytics"],
    ["blocked-status"],
    ["work-item-links"],
    ["personal-backlog"],
    ["tasks"],
    ["task"],
  ],
  sprints: [["sprints"], ["sprint"]],
  docs: [["project-docs"]],
  comments: [["comments"]],
  "time-logs": [["time-logs"], ["estimates-vs-actuals"]],
  members: [["members"], ["project-members"]],
  teams: [["project-teams"]],
  departments: [["departments"], ["department-members"], ["department-permissions"]],
  github: [
    ["github-repo"],
    ["github-user-repos"],
    ["github-repo-branches"],
    ["github-task-events"],
    ["github-releases"],
    ["github-issues"],
    ["github-project-commits"],
    ["github-project-pull-requests"],
  ],
  webhooks: [["webhooks"], ["webhook-deliveries"]],
  "saved-views": [["saved-views"]],
  notifications: [["notifications"]],
  organizations: [["organizations"], ["organization"], ["org-members"]],
  workspaces: [["workspaces"], ["workspace"], ["workspace-info"]],
  spaces: [["spaces"], ["space"]],
  activity: [["activity-logs"]],
  attachments: [["attachments"]],
  "agent-context": [["agent-context"], ["agent-briefing"]],
};

const CHANNEL_NAME = "fairlx-query-sync";
const STORAGE_KEY = "fairlx-query-sync";

type SyncMessage = {
  origin: string;
  queryKeys: QueryKey[];
  nonce: number;
};

let tabId = "";
let remoteDepth = 0;
let pendingKeys: QueryKey[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let channel: BroadcastChannel | null | undefined;

function getTabId(): string {
  if (tabId) return tabId;
  tabId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `tab-${Math.random().toString(36).slice(2)}`;
  return tabId;
}

function canUseWindow(): boolean {
  return typeof window !== "undefined";
}

function isQueryKey(value: unknown): value is QueryKey {
  return Array.isArray(value) && value.length > 0;
}

export function normalizeToolName(rawName: string): string {
  return rawName.trim().replace(/^fairlx_/i, "");
}

const WRITE_RULES: Array<{ test: RegExp; kinds: FairlxSyncKind[] }> = [
  { test: /^(create_project|project_create|project_update|project_delete)$/, kinds: ["projects"] },
  {
    test: /^(work_item_create|work_item_update|work_item_bulk_update|work_item_split|work_item_delete)$/,
    kinds: ["work-items", "sprints", "activity"],
  },
  { test: /^(subtask_create|subtask_update|subtask_delete)$/, kinds: ["work-items"] },
  {
    test: /^(sprint_create|sprint_update|sprint_start|sprint_complete|sprint_delete)$/,
    kinds: ["sprints", "work-items"],
  },
  { test: /^(doc_create|doc_update|doc_delete)$/, kinds: ["docs"] },
  { test: /^(comment_add|comment_update|comment_delete)$/, kinds: ["comments"] },
  { test: /^(link_create|link_delete)$/, kinds: ["work-items"] },
  { test: /^(time_log_add|time_log_delete)$/, kinds: ["time-logs"] },
  {
    test: /^(project_member_add|workspace_member_add|workspace_member_remove|workspace_member_update)$/,
    kinds: ["members"],
  },
  {
    test: /^(project_team_create|project_team_update|project_team_delete|project_team_member_add|project_team_member_remove)$/,
    kinds: ["teams", "members"],
  },
  { test: /^(department_create|department_permission_add)$/, kinds: ["departments"] },
  { test: /^(github_sync|github_write_file|github_open_pr)$/, kinds: ["github"] },
  { test: /^(webhook_create|webhook_delete)$/, kinds: ["webhooks"] },
  { test: /^(saved_view_create|saved_view_delete)$/, kinds: ["saved-views"] },
  { test: /^notification_mark_read$/, kinds: ["notifications"] },
  { test: /^organization_update$/, kinds: ["organizations"] },
  { test: /^custom_field_set$/, kinds: ["work-items"] },
];

export function kindsFromToolName(rawName: string): FairlxSyncKind[] {
  const name = normalizeToolName(rawName);
  if (!name || name === "mcp_call") return [];
  const kinds = new Set<FairlxSyncKind>();
  for (const rule of WRITE_RULES) {
    if (rule.test.test(name)) {
      for (const kind of rule.kinds) kinds.add(kind);
    }
  }
  if (kinds.size > 0) kinds.add("agent-context");
  return [...kinds];
}

export function queryKeysForKinds(kinds: Iterable<FairlxSyncKind>): QueryKey[] {
  const seen = new Set<string>();
  const keys: QueryKey[] = [];
  for (const kind of kinds) {
    const prefixes = FAIRLX_SYNC_QUERY_KEYS[kind];
    if (!prefixes) continue;
    for (const key of prefixes) {
      const id = JSON.stringify(key);
      if (seen.has(id)) continue;
      seen.add(id);
      keys.push(key);
    }
  }
  return keys;
}

export function applyFairlxSyncKinds(queryClient: QueryClient, kinds: Iterable<FairlxSyncKind>): void {
  for (const queryKey of queryKeysForKinds(kinds)) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

function getChannel(): BroadcastChannel | null {
  if (!canUseWindow()) return null;
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
  } catch {
    channel = null;
  }
  return channel;
}

function uniqueQueryKeys(keys: QueryKey[]): QueryKey[] {
  const seen = new Set<string>();
  const out: QueryKey[] = [];
  for (const key of keys) {
    if (!isQueryKey(key)) continue;
    const id = JSON.stringify(key);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(key);
  }
  return out;
}

function postSyncMessage(queryKeys: QueryKey[]): void {
  if (!canUseWindow() || queryKeys.length === 0) return;
  const message: SyncMessage = {
    origin: getTabId(),
    queryKeys,
    nonce: Date.now(),
  };
  const live = getChannel();
  if (live) {
    try {
      live.postMessage(message);
      return;
    } catch {
      /* fall through to localStorage */
    }
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
  } catch {
    /* ignore quota / private mode */
  }
}

function enqueueBroadcast(queryKey: QueryKey): void {
  pendingKeys.push(queryKey);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const keys = uniqueQueryKeys(pendingKeys);
    pendingKeys = [];
    postSyncMessage(keys);
  }, 0);
}

export function applyRemoteQueryKeys(queryClient: QueryClient, queryKeys: QueryKey[]): void {
  remoteDepth += 1;
  try {
    for (const queryKey of uniqueQueryKeys(queryKeys)) {
      void queryClient.invalidateQueries({ queryKey });
    }
  } finally {
    remoteDepth -= 1;
  }
}

export function installFairlxQuerySync(queryClient: QueryClient): QueryClient {
  const original = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = ((filters?: unknown, options?: unknown) => {
    const result = original(filters as never, options as never);
    if (
      remoteDepth === 0 &&
      filters &&
      typeof filters === "object" &&
      "queryKey" in filters &&
      isQueryKey((filters as { queryKey?: unknown }).queryKey)
    ) {
      enqueueBroadcast((filters as { queryKey: QueryKey }).queryKey);
    }
    return result;
  }) as typeof queryClient.invalidateQueries;
  return queryClient;
}

export function parseSyncMessage(raw: unknown): SyncMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<SyncMessage>;
  if (typeof record.origin !== "string" || !Array.isArray(record.queryKeys)) return null;
  return {
    origin: record.origin,
    queryKeys: uniqueQueryKeys(record.queryKeys.filter(isQueryKey)),
    nonce: typeof record.nonce === "number" ? record.nonce : 0,
  };
}

export function subscribeFairlxQuerySync(
  queryClient: QueryClient,
  onMessage?: (message: SyncMessage) => void,
): () => void {
  if (!canUseWindow()) return () => undefined;
  const origin = getTabId();

  const handle = (raw: unknown) => {
    const message = parseSyncMessage(raw);
    if (!message || message.origin === origin || message.queryKeys.length === 0) return;
    applyRemoteQueryKeys(queryClient, message.queryKeys);
    onMessage?.(message);
  };

  const onChannel = (event: MessageEvent) => handle(event.data);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      handle(JSON.parse(event.newValue) as unknown);
    } catch {
      /* ignore */
    }
  };

  const liveChannel = getChannel();
  liveChannel?.addEventListener("message", onChannel);
  window.addEventListener("storage", onStorage);
  return () => {
    liveChannel?.removeEventListener("message", onChannel);
    window.removeEventListener("storage", onStorage);
  };
}
