"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { useProjectId } from "@/features/projects/hooks/use-project-id";
import { useWorkspaceId } from "@/features/workspaces/hooks/use-workspace-id";

import {
  defaultPageSnapshot,
  formatPageContextBlock,
  mergePageSnapshots,
  type PageSnapshot,
} from "../lib/page-context";
import {
  isSafeInAppPath,
  pageUiActionSupported,
  type PageUiApplyResult,
  type ParsedPageUiAction,
} from "../lib/page-ui-action";

type PageRegistration = {
  getSnapshot: () => Partial<PageSnapshot> | PageSnapshot;
  apply?: (action: ParsedPageUiAction) => PageUiApplyResult | boolean | void;
};

type AgentPageContextValue = {
  getSnapshot: () => PageSnapshot;
  applyAction: (action: ParsedPageUiAction) => PageUiApplyResult;
  register: (registration: PageRegistration) => () => void;
};

const AgentPageContext = createContext<AgentPageContextValue | null>(null);

function routeId(value?: string | null): string | undefined {
  if (!value || value === "undefined" || value === "null") return undefined;
  return value;
}

function liveHeading(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const text = document.querySelector("main h1")?.textContent?.trim();
  return text || undefined;
}

function liveSearch(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.location.search || undefined;
}

export function AgentPageProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const workspaceId = routeId(useWorkspaceId());
  const projectId = routeId(useProjectId());
  const stackRef = useRef<PageRegistration[]>([]);

  const getSnapshot = useCallback((): PageSnapshot => {
    const base = defaultPageSnapshot({
      pathname,
      search: liveSearch(),
      workspaceId,
      projectId,
      heading: liveHeading(),
    });
    const top = stackRef.current[stackRef.current.length - 1];
    if (!top) return base;
    try {
      return mergePageSnapshots(base, top.getSnapshot());
    } catch {
      return base;
    }
  }, [pathname, workspaceId, projectId]);

  const applyAction = useCallback(
    (action: ParsedPageUiAction): PageUiApplyResult => {
      const snapshot = getSnapshot();
      for (let index = stackRef.current.length - 1; index >= 0; index -= 1) {
        const apply = stackRef.current[index]?.apply;
        if (!apply) continue;
        try {
          const result = apply(action);
          if (result === true) return { ok: true };
          if (result && typeof result === "object") return result;
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "Page action failed." };
        }
      }

      if (action.action === "navigate") {
        const path = action.path?.trim() || "";
        if (!isSafeInAppPath(path, workspaceId)) {
          return { ok: false, error: "That path is not allowed from this chat." };
        }
        router.push(path);
        return { ok: true, detail: path };
      }

      if (action.action === "set_view" && action.view && typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("task-view", action.view);
        router.push(`${url.pathname}${url.search}`);
        return { ok: true, detail: action.view };
      }

      if (!pageUiActionSupported(snapshot, action.action)) {
        return { ok: false, error: `${action.action} is not available on ${snapshot.page}.` };
      }
      return { ok: false, error: `${action.action} is not wired on this page.` };
    },
    [getSnapshot, router, workspaceId],
  );

  const register = useCallback((registration: PageRegistration) => {
    stackRef.current = [...stackRef.current, registration];
    return () => {
      stackRef.current = stackRef.current.filter((item) => item !== registration);
    };
  }, []);

  const value = useMemo(
    () => ({ getSnapshot, applyAction, register }),
    [getSnapshot, applyAction, register],
  );

  return <AgentPageContext.Provider value={value}>{children}</AgentPageContext.Provider>;
}

export function useAgentPageSnapshot(): PageSnapshot | undefined {
  const ctx = useContext(AgentPageContext);
  return ctx?.getSnapshot();
}

export function useAgentPageContextBlock(): string {
  const snapshot = useAgentPageSnapshot();
  return formatPageContextBlock(snapshot);
}

export function useAgentPageActions() {
  return useContext(AgentPageContext);
}

export function useRegisterAgentPage(
  getSnapshot: () => Partial<PageSnapshot> | PageSnapshot,
  apply?: (action: ParsedPageUiAction) => PageUiApplyResult | boolean | void,
) {
  const ctx = useContext(AgentPageContext);
  const snapshotRef = useRef(getSnapshot);
  snapshotRef.current = getSnapshot;
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (!ctx) return;
    return ctx.register({
      getSnapshot: () => snapshotRef.current(),
      apply: (action) => applyRef.current?.(action),
    });
  }, [ctx]);
}
