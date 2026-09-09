"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  Loader2,
  Pin,
  Trash2,
  RotateCcw,
  Pencil,
  GitBranch,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  Eye,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  SquareTerminal,
} from "lucide-react";
import { RiAddCircleFill } from "react-icons/ri";

import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectAvatar } from "@/features/projects/components/project-avatar";
import { useCreateProjectModal } from "@/features/projects/hooks/use-create-project-modal";

import { useGetAgentAiConfig } from "../api/use-agent-ai-config";
import { useGetAgentContext } from "../api/use-agent-context";
import { useGetAgentHarness, useUpdateAgentHarness } from "../api/use-agent-harness";
import { AGENT_CONTEXT_QUERY_KEY } from "../constants";
import {
  useConfirmAgentRun,
  useContinueAgentRun,
  useDenyAgentRun,
  useDeleteAgentRun,
  useGetAgentRun,
  usePatchAgentRun,
  useSendAgentMessage,
  useStopAgentRun,
} from "../api/use-agent-runs";
import { useAgentMutationSync } from "../hooks/use-agent-mutation-sync";
import { clockTime, relativeTime } from "../lib/agent-ui";
import { extractBoardProject, withWorkspaceFallback } from "../lib/project-launch";
import { looksLikeLlmUsageEvent } from "../lib/run-usage";
import type { AgentRun, AgentToolEvent, CodingSession } from "../types";
import { AgentChatThread } from "./agent-chat-thread";
import { AgentCommandInput } from "./agent-command-input";
import { AgentCrewPanel } from "./agent-crew-panel";
import { GitHubOptionalPrompt } from "@/features/github-integration/components";
import { DiffViewer, type CheckRun, type DiffFile } from "./diff-viewer";
import { CodingSessionPanel } from "./coding-session-panel";
import { SessionArtifacts } from "./session-artifacts";
import { ImplementationPlanCard } from "./implementation-plan-card";
import { resolveRunImplementationPlan } from "../lib/implementation-plan";
import { describeCodingPreview } from "../lib/sandbox-preview";
import { shouldRecoverInterruptedTurn } from "../lib/optimistic-run";
import { tabTone, type WorkflowSidebarTab } from "../lib/sidebar-theme";
import {
  AccentCard,
  SidebarEmptyState,
  SidebarIconWell,
  StatusPill,
} from "./workflow-sidebar-ui";
import { useCommentCodingSession, useGetCodingSession, useMergeCodingSession, useStartCodingSession } from "../api/use-coding-session";
import { toast } from "sonner";

/** Most recent error recorded on the coding session (Azure RBAC, clone, install…). */
function lastSessionError(session: CodingSession): string {
  const errors = (session.events ?? []).filter((event) => event.type === "error" && event.detail);
  return errors[errors.length - 1]?.detail ?? "";
}

const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 760;
const SIDEBAR_DEFAULT = 384;
const SIDEBAR_COLLAPSED = 44;
const SIDEBAR_WIDTH_KEY = "fairlx.agent.workflow.sidebarWidth";
const SIDEBAR_COLLAPSED_KEY = "fairlx.agent.workflow.sidebarCollapsed";

const SIDEBAR_TABS: ReadonlyArray<readonly [WorkflowSidebarTab, string, LucideIcon]> = [
  ["plan", "Plan", ClipboardList],
  ["context", "Context", Layers],
  ["changes", "Changes", GitBranch],
  ["terminal", "Terminal", SquareTerminal],
  ["preview", "Preview", Eye],
];

function clampSidebarWidth(value: number) {
  const max = typeof window === "undefined" ? SIDEBAR_MAX : Math.min(SIDEBAR_MAX, window.innerWidth * 0.7);
  return Math.min(max, Math.max(SIDEBAR_MIN, value));
}


function FloatingComposer({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40">
      <div className="bg-gradient-to-t from-background via-background to-transparent pt-12">
        <div className="pointer-events-auto mx-auto w-full max-w-[760px] px-4 pb-5 bg-background">
          {children}
        </div>
      </div>
    </div>
  );
}


function ProjectSelectorRow({
  run,
  projects,
  selectedProject,
}: {
  run: AgentRun;
  projects: Array<{ id: string; name: string; workspaceId: string; imageUrl?: string; key?: string; status?: string }>;
  selectedProject?: { id: string; name: string; workspaceId: string; imageUrl?: string };
  workspaceId?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const patchRun = usePatchAgentRun();
  const updateHarness = useUpdateAgentHarness();
  const { open: openCreateProject } = useCreateProjectModal();

  const handleSelect = (projId: string | null) => {
    const nextProject = projects.find((p) => p.id === projId);
    patchRun.mutate({
      param: { runId: run.id },
      json: {
        projectId: projId || "",
        ...(nextProject ? { workspaceId: nextProject.workspaceId } : {}),
      },
    });
    updateHarness.mutate({
      json: {
        settings: {
          defaultProjectId: projId || undefined,
          ...(nextProject ? { defaultWorkspaceId: nextProject.workspaceId } : {}),
        },
      },
    });
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-1.5 px-1">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 text-[11px] tracking-wider uppercase font-semibold text-sidebar-foreground/50 hover:text-sidebar-foreground/70 transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          Projects
        </button>
        <RiAddCircleFill
          onClick={() => openCreateProject()}
          className="size-5 text-sidebar-foreground/70 cursor-pointer hover:opacity-75 transition"
        />
      </div>

      <div
        className={`transition-all duration-300 overflow-hidden ${
          isExpanded ? "max-h-96" : "max-h-0"
        }`}
      >
        <Select
          onValueChange={(val) => handleSelect(val === "none" ? null : val)}
          value={selectedProject?.id || "none"}
        >
          <SelectTrigger className="w-full p-2 font-medium text-xs bg-sidebar-accent/50 border-sidebar-border text-sidebar-foreground/90 h-9">
            <SelectValue placeholder="No project selected." />
          </SelectTrigger>

          <SelectContent className="bg-popover border-border max-h-72">
            <SelectItem value="none">
              <div className="flex items-center gap-3 font-medium">
                <div className="size-6 rounded-md bg-muted flex items-center justify-center text-muted-foreground text-xs font-semibold">
                  —
                </div>
                <span className="truncate text-xs text-muted-foreground">No project selected.</span>
              </div>
            </SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                <div className="flex items-center gap-3 font-medium">
                  <ProjectAvatar
                    name={project.name}
                    image={project.imageUrl}
                    className="size-6 text-[10px]"
                  />
                  <span className="truncate text-xs">{project.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function WorkflowSidebar({
  run,
  events,
  tab,
  onTab,
}: {
  run: AgentRun;
  events: AgentToolEvent[];
  tab: WorkflowSidebarTab;
  onTab: (tab: WorkflowSidebarTab) => void;
}) {
  const { data: context } = useGetAgentContext();
  const { data: harness } = useGetAgentHarness();
  const { data: ai } = useGetAgentAiConfig();
  const workspace = context?.workspaces.find((item) => item.id === run.workspaceId) ?? context?.workspaces[0];
  const workspaceId = run.workspaceId || harness?.settings.defaultWorkspaceId || workspace?.id;
  const workspaceProjects = useMemo(
    () => (context?.projects ?? []).filter((item) => !workspaceId || item.workspaceId === workspaceId),
    [context?.projects, workspaceId]
  );
  const launch = useMemo(
    () => withWorkspaceFallback(extractBoardProject(run.messages), run.workspaceId || workspaceId),
    [run.messages, run.workspaceId, workspaceId],
  );
  const effectiveProjectId = run.projectId || launch?.projectId || harness?.settings.defaultProjectId;
  const project = useMemo(() => {
    const fromContext = context?.projects.find((item) => item.id === effectiveProjectId);
    if (fromContext) return fromContext;
    if (launch && launch.projectId === effectiveProjectId) {
      return { id: launch.projectId, name: launch.name || "Project", workspaceId: launch.workspaceId };
    }
    return undefined;
  }, [context?.projects, effectiveProjectId, launch]);
  const projectsForSelect = useMemo(() => {
    const list = [...workspaceProjects];
    if (project && !list.some((item) => item.id === project.id)) {
      list.unshift(project);
    }
    return list;
  }, [workspaceProjects, project]);
  const { data: sessionPayload } = useGetCodingSession({
    runId: run.id,
    projectId: project?.id,
  });
  const startSession = useStartCodingSession();
  const commentSession = useCommentCodingSession();
  const mergeSession = useMergeCodingSession();
  const session = sessionPayload?.session;
  const previewMeta = describeCodingPreview({
    previewUrl: session?.previewUrl,
    status: session?.status,
    sandboxId: session?.sandboxId,
    driver: session?.driver,
    previewLive: session?.previewLive,
  });
  const previewKey = session?.previewUrl || (session?.sandboxId ? `sandbox:${session.sandboxId}` : "");
  const previewShownRef = useRef<string | null>(null);
  useEffect(() => {
    if (!previewKey || previewShownRef.current === previewKey) return;
    if (!previewMeta.live) return;
    previewShownRef.current = previewKey;
    onTab("preview");
  }, [previewKey, previewMeta.live, previewMeta.stub, onTab]);
  const diffFiles = (Array.isArray(sessionPayload?.diff?.files) ? sessionPayload.diff.files : []) as DiffFile[];
  const checks = (Array.isArray(sessionPayload?.diff?.checks) ? sessionPayload.diff.checks : []) as CheckRun[];
  const walkthrough = typeof sessionPayload?.walkthrough === "string" ? sessionPayload.walkthrough : undefined;
  const workItemId = context?.workItems.find((item) => item.projectId === project?.id)?.id;
  const staging = harness?.gitStaging?.items ?? [];
  const live = events
    .filter((event) => event.type !== "context_meter" && !looksLikeLlmUsageEvent(event))
    .slice(-40);
  const activityLive =
    run.status === "running" || run.status === "awaiting_confirmation" || run.status === "awaiting_plugin";
  const [activityOpen, setActivityOpen] = useState(activityLive);
  useEffect(() => {
    setActivityOpen(activityLive);
  }, [activityLive]);
  const repo = (context?.githubRepos ?? []).find((item) => item.projectId === project?.id);
  const terminals = events.filter((event) => event.type === "terminal" || event.type === "coding_session_exec");
  const githubUrl = repo?.githubUrl || (repo?.owner && repo.repositoryName ? `https://github.com/${repo.owner}/${repo.repositoryName}` : "");
  const prLinks = events
    .filter((event) => event.type === "github_open_pr" || event.type === "github_write_file" || event.type === "github_create_repo" || event.type === "github_update_repo" || event.type === "github_create_issue")
    .map((event) => {
      const payload = event.payload && typeof event.payload === "object" ? (event.payload as { html_url?: string; title?: string; path?: string }) : {};
      return {
        id: event.id,
        url: typeof payload.html_url === "string" ? payload.html_url : "",
        label: payload.title || payload.path || event.title,
      };
    })
    .filter((item) => item.url);
  const implementationPlan = resolveRunImplementationPlan(run);
  const [width, setWidth] = useState(SIDEBAR_DEFAULT);
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarReady, setSidebarReady] = useState(false);
  const widthRef = useRef(width);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  useEffect(() => {
    const storedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(storedWidth) && storedWidth > 0) setWidth(clampSidebarWidth(storedWidth));
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    setSidebarReady(true);
  }, []);

  useEffect(() => {
    if (!sidebarReady) return;
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  }, [sidebarReady, width]);

  useEffect(() => {
    if (!sidebarReady) return;
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed, sidebarReady]);

  const startResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const onMove = (move: globalThis.MouseEvent) => {
      setCollapsed(false);
      setWidth(clampSidebarWidth(startWidth + (startX - move.clientX)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const stagingFiles = staging
    .filter((item) => !diffFiles.some((file) => file.filename === item.path))
    .map((item) => ({
      filename: item.path,
      status: "modified",
      additions: 0,
      deletions: 0,
      changes: 0,
      patch: item.content,
    })) as DiffFile[];
  const changeFiles = [...diffFiles, ...stagingFiles];

  return (
    <aside
      style={{ width: collapsed ? SIDEBAR_COLLAPSED : width }}
      className="relative hidden h-full flex-shrink-0 flex-col overflow-hidden border-l border-sidebar-border bg-sidebar lg:flex"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize right panel"
        title="Drag to resize"
        onMouseDown={startResize}
        onDoubleClick={() => setCollapsed((value) => !value)}
        className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize hover:bg-primary/40 active:bg-primary/50"
      />
      {collapsed ? (
        <div className="flex h-full flex-col items-center gap-1 py-2">
          <button
            type="button"
            title="Expand panel"
            onClick={() => setCollapsed(false)}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelRightOpen className="size-4" />
          </button>
          {SIDEBAR_TABS.map(([id, label, Icon]) => {
            const tone = tabTone(id);
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                title={id === "changes" && changeFiles.length ? `${label} · ${changeFiles.length}` : label}
                onClick={() => {
                  onTab(id);
                  setCollapsed(false);
                }}
                className={cn(
                  "relative flex size-8 items-center justify-center rounded-lg transition-colors",
                  active ? cn(tone.bg, tone.text) : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {id === "changes" && changeFiles.length ? (
                  <span className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-emerald-500 px-0.5 text-center text-[9px] font-semibold leading-[14px] text-white">
                    {changeFiles.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <>
      <div className="flex shrink-0 items-stretch border-b border-sidebar-border bg-sidebar">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {SIDEBAR_TABS.map(([id, label, Icon]) => {
            const tone = tabTone(id);
            const active = tab === id;
            return (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => onTab(id)}
            className={cn(
              "relative inline-flex min-w-[3.75rem] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2.5 text-[11px] font-semibold transition-colors",
              active ? tone.text : "text-muted-foreground hover:bg-sidebar-accent/40 hover:text-foreground",
              active && tone.bg,
            )}
          >
            <Icon className="size-3.5" />
            <span className="inline-flex items-center gap-0.5">
              {label}
              {id === "changes" && changeFiles.length ? (
                <span
                  className={cn(
                    "inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold tabular-nums",
                    active ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground",
                  )}
                >
                  {changeFiles.length}
                </span>
              ) : null}
            </span>
            {active ? <span className={cn("absolute inset-x-2 bottom-0 h-0.5 rounded-full", tone.bar)} /> : null}
          </button>
            );
          })}
        </div>
        <button
          type="button"
          title="Collapse panel"
          onClick={() => setCollapsed(true)}
          className="flex w-9 shrink-0 items-center justify-center border-l border-sidebar-border text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          tab === "changes" ? "overflow-hidden" : "custom-scrollbar gap-5 overflow-y-auto p-4",
        )}
      >
        {tab === "plan" ? (
          <div className="space-y-3">
            {implementationPlan ? (
              <ImplementationPlanCard plan={implementationPlan} />
            ) : (
              <SidebarEmptyState icon={ClipboardList} tone="blue" title="No plan yet">
                The agent submits an implementation plan here before coding. Accept it to start the Azure session.
              </SidebarEmptyState>
            )}
          </div>
        ) : null}

        {tab === "context" ? (
          <>
            <div className="flex flex-col gap-3">
              <ProjectSelectorRow
                run={run}
                projects={projectsForSelect}
                selectedProject={project}
                workspaceId={workspace?.id}
              />
              <AgentCrewPanel run={run} ai={ai} />
              <CodingSessionPanel
                session={session}
                onStart={
                  workItemId
                    ? () => startSession.mutate({ workItemId, projectId: project?.id, runId: run.id })
                    : undefined
                }
              />
              {project && !repo && project.workspaceId ? (
                <GitHubOptionalPrompt projectId={project.id} workspaceId={project.workspaceId} compact />
              ) : null}
            </div>

            <hr className="border-sidebar-border" />

            <div>
              <div className="flex items-center justify-between mb-3 px-1">
                <button
                  type="button"
                  onClick={() => setActivityOpen((value) => !value)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider hover:text-sidebar-foreground/70 transition-colors"
                >
                  {activityOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  Live Activity
                </button>
                {activityLive ? (
                  <div className="flex items-center gap-1.5 text-xs text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full font-medium">
                    <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
                    Live
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground capitalize font-medium">{run.status.replace(/_/g, " ")}</span>
                )}
              </div>
              {live.length === 0 ? (
                <p className="text-xs text-muted-foreground px-1">No activity yet.</p>
              ) : activityOpen ? (
                <div className="relative pl-3 border-l-2 border-sidebar-border flex flex-col gap-3 ml-2">
                  {live.map((event, index) => {
                    const latest = index === live.length - 1 && activityLive;
                    const failed = event.type === "error" || /fail/i.test(event.title);
                    const thinking = event.type === "thought" || event.type === "subagent_progress";
                    return (
                      <div key={event.id} className="relative">
                        <div
                          className={cn(
                            "absolute -left-[18px] top-1.5 size-2 rounded-full",
                            latest
                              ? "bg-primary shadow-[0_0_6px_rgba(59,130,246,0.8)]"
                              : failed
                                ? "bg-destructive"
                                : thinking
                                  ? "bg-primary/50"
                                  : "bg-muted-foreground/50"
                          )}
                        />
                        <div className="flex items-start text-xs">
                          <span className={cn("w-14 shrink-0 text-[11px]", latest ? "text-primary font-medium" : "text-muted-foreground")}>
                            {clockTime(event.createdAt, true)}
                          </span>
                          <div className="flex-1 ml-1.5 min-w-0">
                            <span
                              className={cn(
                                "block",
                                latest ? "text-primary font-medium" : failed ? "text-destructive font-medium" : "text-foreground"
                              )}
                            >
                              {event.title}
                            </span>
                            {event.detail ? (
                              <span className="block text-[11px] text-muted-foreground mt-0.5 line-clamp-3 whitespace-pre-wrap">
                                {event.detail}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground px-1">
                  {live.length} {live.length === 1 ? "event" : "events"} · expand to review
                </p>
              )}
            </div>

          </>
        ) : null}

        {tab === "changes" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {changeFiles.length ? (
              <div className="min-h-0 flex-1">
                <DiffViewer
                  files={changeFiles}
                  checks={checks}
                  walkthrough={walkthrough}
                  branch={session?.headBranch || repo?.branch || "main"}
                  onComment={
                    session
                      ? (path, line, body) => commentSession.mutate({ sessionId: session.id, path, line, body })
                      : undefined
                  }
                  onMerge={session?.prNumber ? () => mergeSession.mutate(session.id) : undefined}
                  merging={mergeSession.isPending}
                />
              </div>
            ) : (
              <div className="p-4">
              <SidebarEmptyState
                icon={GitBranch}
                tone="emerald"
                title={repo ? "No changes yet" : "Connect GitHub"}
              >
                {repo
                  ? "No pull requests yet. After the sandbox pushes fairlx/{key}, the in-app diff appears here."
                  : "Connect your GitHub account to edit code and review diffs in this panel."}
              </SidebarEmptyState>
              </div>
            )}
            {session?.artifacts?.length || session?.meta?.artifacts?.length ? (
              <div className="shrink-0 border-t border-sidebar-border p-2">
                <SessionArtifacts session={session} />
              </div>
            ) : null}
            {prLinks.length ? (
              <div className="shrink-0 space-y-1 border-t border-sidebar-border p-2">
                {prLinks.map((item) => (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 truncate rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15"
                  >
                    <ExternalLink className="size-3 shrink-0" />
                    {item.label}
                  </a>
                ))}
              </div>
            ) : null}
            {repo ? (
              <a
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 border-t border-sidebar-border px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:underline"
              >
                <GitBranch className="size-3.5" /> Open {repo.owner}/{repo.repositoryName}
              </a>
            ) : null}
          </div>
        ) : null}

        {tab === "terminal" ? (
          <div className="space-y-2">
            {terminals.length === 0 ? (
              <SidebarEmptyState icon={SquareTerminal} tone="amber" title="No terminal output">
                {session?.sandboxId
                  ? "No sandbox output yet. The agent’s terminal and coding_session_exec results appear here."
                  : "No recorded commands. Start a coding session so commands run in Azure, not on the Fairlx host."}
              </SidebarEmptyState>
            ) : (
              terminals.map((event) => (
                <div
                  key={event.id}
                  className="overflow-hidden rounded-xl border border-amber-500/25 bg-zinc-50 text-[11px] text-zinc-800 shadow-sm dark:border-amber-500/20 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-100 px-3 py-1.5 dark:border-white/10 dark:bg-zinc-900">
                    <span className="flex items-center gap-1">
                      <span className="size-2 rounded-full bg-rose-400/90" />
                      <span className="size-2 rounded-full bg-amber-400/90" />
                      <span className="size-2 rounded-full bg-emerald-400/90" />
                    </span>
                    <SquareTerminal className="size-3 text-amber-600 dark:text-amber-300" />
                    <span className="min-w-0 flex-1 truncate font-medium text-zinc-700 dark:text-zinc-200">{event.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">{clockTime(event.createdAt, true)}</span>
                  </div>
                  {event.detail ? (
                    <pre className="custom-scrollbar max-h-56 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-300/90">
                      {event.detail}
                    </pre>
                  ) : (
                    <p className="px-3 py-2 text-zinc-500">No output captured.</p>
                  )}
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === "preview" ? (
          <div className="space-y-3">
            {session ? (
              <AccentCard tone={previewMeta.live ? "cyan" : previewMeta.stub ? "amber" : "sky"}>
                <div className="space-y-2 p-3">
                  <div className="flex items-start gap-2">
                    <SidebarIconWell icon={Eye} tone={previewMeta.live ? "cyan" : previewMeta.stub ? "amber" : "sky"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[12px] font-semibold text-foreground">Sandbox preview</p>
                        <StatusPill
                          kind={
                            previewMeta.live
                              ? "live"
                              : previewMeta.stub
                                ? "warn"
                                : previewMeta.preparing || session.status === "preparing" || session.status === "queued"
                                  ? "info"
                                  : "idle"
                          }
                        >
                          {previewMeta.live
                            ? "live"
                            : previewMeta.stub
                              ? "not live"
                              : session.status.replace(/_/g, " ")}
                        </StatusPill>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {previewMeta.driver !== "none" ? `${previewMeta.driver} · ` : ""}
                        {session.status.replace(/_/g, " ")}
                      </p>
                    </div>
                  </div>
                {session.codingAgent ? (
                  <p className="text-[11px] text-muted-foreground">
                    Coder: {session.codingAgent === "claude_code" ? "Claude Code in sandbox" : session.codingAgent === "codex" ? "Codex in sandbox" : "Fairlx specialists (CLI credentials missing)"}
                  </p>
                ) : null}
                {session.status !== "failed" && (previewMeta.preparing || session.status === "preparing" || session.status === "queued") ? (
                  <div className="flex items-center gap-2 rounded-lg bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-700 dark:text-sky-300">
                    <Loader2 className="size-3.5 animate-spin" />
                    {previewMeta.note || "Preparing clone, install, and dev server…"}
                  </div>
                ) : null}
                {previewMeta.stub ? (
                  <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">{previewMeta.note}</p>
                ) : null}
                {session.status === "failed" ? (
                  <div className="space-y-2 rounded-lg border border-red-500/25 bg-red-500/[0.07] dark:bg-red-500/10 p-3 text-[11.5px]">
                    <div className="flex items-center gap-1.5 font-semibold text-red-700 dark:text-red-300">
                      <AlertCircle className="size-4 text-red-500 dark:text-red-400 shrink-0" />
                      <span>Sandbox could not start</span>
                    </div>
                    <p className="font-mono text-[10.5px] text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-all leading-relaxed max-h-40 overflow-y-auto rounded bg-black/5 dark:bg-black/25 p-2 border border-red-500/10">
                      {lastSessionError(session) || "The Azure sandbox failed before the app started."}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <Button
                        type="button"
                        size="xs"
                        variant="secondary"
                        disabled={startSession.isPending}
                        onClick={() =>
                          startSession.mutate({ workItemId: session.workItemId, projectId: session.projectId, runId: run.id })
                        }
                      >
                        {startSession.isPending ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                        Retry in Azure
                      </Button>
                      <span className="text-[10px] text-muted-foreground">Fairlx re-checks Azure access live before retrying.</span>
                    </div>
                  </div>
                ) : null}
                {!previewMeta.live && previewMeta.url && session.status !== "failed" ? (
                  <div className="flex items-center gap-2 rounded-lg bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-800 dark:text-sky-200">
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{previewMeta.url}</span>
                    <span className="shrink-0">public URL reserved · app still starting</span>
                  </div>
                ) : null}
                {previewMeta.live && previewMeta.url ? (
                  <>
                    <p className="text-[11px] text-muted-foreground">
                      In-app browser for the Azure sandbox app (not github.dev).
                    </p>
                    <div className="overflow-hidden rounded-xl border border-cyan-500/25 bg-zinc-50 dark:bg-zinc-950">
                      <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-100 px-2.5 py-1.5 dark:border-white/10 dark:bg-zinc-900">
                        <span className="flex items-center gap-1">
                          <span className="size-2 rounded-full bg-rose-400/90" />
                          <span className="size-2 rounded-full bg-amber-400/90" />
                          <span className="size-2 rounded-full bg-emerald-400/90" />
                        </span>
                        <a
                          href={previewMeta.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open preview in a new tab"
                          className="min-w-0 flex-1 truncate rounded-md bg-white px-2 py-0.5 font-mono text-[10px] text-zinc-600 hover:text-zinc-900 hover:underline dark:bg-zinc-800 dark:text-zinc-300 dark:hover:text-white"
                        >
                          {previewMeta.url}
                        </a>
                      </div>
                      <iframe
                        title="Sandbox app preview"
                        src={previewMeta.url}
                        className="w-full min-h-[28rem] bg-background"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={previewMeta.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1 truncate text-[11px] font-medium text-cyan-700 dark:text-cyan-300"
                      >
                        {previewMeta.url}
                      </a>
                      <Button type="button" size="xs" variant="secondary" asChild>
                        <a href={previewMeta.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="size-3" /> Open
                        </a>
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="secondary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(previewMeta.url);
                            toast.success("Preview link copied. Anyone with the link can open it while the sandbox runs.");
                          } catch {
                            /* ignore */
                          }
                        }}
                      >
                        <Copy className="size-3" /> Copy share link
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Public Azure sandbox URL — shareable without a Fairlx login while the sandbox is running.
                    </p>
                  </>
                ) : null}
                <SessionArtifacts session={session} embedded />
                </div>
              </AccentCard>
            ) : (
              <SidebarEmptyState icon={Eye} tone="cyan" title="No sandbox yet">
                After you Accept the implementation plan, Fairlx clones the repo in Azure, installs, starts the app, and the live preview appears here.
              </SidebarEmptyState>
            )}
            {githubUrl ? (
              <>
                <p className="px-1 text-[11px] text-muted-foreground">
                  Linked GitHub repository (source remote, not the running preview).
                </p>
                <a
                  href={githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                >
                  <span className="inline-flex items-center gap-2">
                    <GitBranch className="size-3.5" />
                    Open Repository
                  </span>
                  <ExternalLink className="size-3.5" />
                </a>
              </>
            ) : project ? (
              <Link
                href={`/workspaces/${project.workspaceId}/projects/${project.id}/github`}
                className="block rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-medium text-amber-800 dark:text-amber-300"
              >
                Connect GitHub so Fairlx can clone the repo in Azure.
              </Link>
            ) : (
              <p className="rounded-xl border border-dashed border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
                Select a project to preview the sandbox app.
              </p>
            )}
          </div>
        ) : null}
      </div>
        </>
      )}
    </aside>
  );
}

function WorkflowViewInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId") ?? undefined;
  const { data: run, isLoading, error } = useGetAgentRun(runId);
  useAgentMutationSync(run);
  const { data: context } = useGetAgentContext();
  const sendMessage = useSendAgentMessage();
  const stopRun = useStopAgentRun();
  const continueRun = useContinueAgentRun();
  const confirmRun = useConfirmAgentRun();
  const denyRun = useDenyAgentRun();
  const deleteRun = useDeleteAgentRun();
  const patchRun = usePatchAgentRun();
  const { data: harness } = useGetAgentHarness();
  const updateHarness = useUpdateAgentHarness();
  const queryClient = useQueryClient();
  const stickToBottomRef = useRef(true);
  const continuedRef = useRef<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const [tab, setTab] = useState<WorkflowSidebarTab>("context");
  const [DeleteDialog, confirmDelete] = useConfirm(
    "Delete Run",
    "Are you sure you want to delete this chat run? This action cannot be undone.",
    "destructive"
  );

  useEffect(() => {
    if (run?.title) setTitle(run.title);
  }, [run?.title]);

  useEffect(() => {
    if (!run) return;
    if (continuedRef.current === run.id) return;
    continuedRef.current = run.id;
    // Recover a refresh mid-turn. Accept/Deny starts its own turn — do not
    // continue when this chat loaded already waiting for approval.
    if (shouldRecoverInterruptedTurn(run)) continueRun.mutate({ runId: run.id });
  }, [run, continueRun]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [run?.messages.length, run?.events.length, run?.status]);

  const boardProject = useMemo(
    () => withWorkspaceFallback(extractBoardProject(run?.messages ?? []), run?.workspaceId),
    [run?.messages, run?.workspaceId],
  );
  const syncedScopeRef = useRef<{ bound?: string; context?: string }>({});

  useEffect(() => {
    if (!run?.id || !boardProject) return;
    const scopeKey = `${run.id}:${boardProject.projectId}:${boardProject.workspaceId}`;
    const known = (context?.projects ?? []).some((item) => item.id === boardProject.projectId);
    if (!known && syncedScopeRef.current.context !== scopeKey) {
      syncedScopeRef.current.context = scopeKey;
      queryClient.invalidateQueries({ queryKey: AGENT_CONTEXT_QUERY_KEY });
    }
    const alreadyBound =
      run.projectId === boardProject.projectId && run.workspaceId === boardProject.workspaceId;
    if (alreadyBound) {
      syncedScopeRef.current.bound = scopeKey;
      return;
    }
    if (syncedScopeRef.current.bound === scopeKey) return;
    syncedScopeRef.current.bound = scopeKey;
    patchRun.mutate({
      param: { runId: run.id },
      json: {
        projectId: boardProject.projectId,
        workspaceId: boardProject.workspaceId,
      },
    });
    updateHarness.mutate({
      json: {
        settings: {
          defaultProjectId: boardProject.projectId,
          defaultWorkspaceId: boardProject.workspaceId,
        },
      },
    });
  }, [
    boardProject,
    context?.projects,
    patchRun,
    queryClient,
    run?.id,
    run?.projectId,
    run?.workspaceId,
    updateHarness,
  ]);

  if (!runId) {
    return (
      <div className="relative h-full min-h-0 overflow-y-auto custom-scrollbar bg-background p-6 sm:p-8 flex flex-col">
        <div className="max-w-3xl mx-auto w-full my-auto pb-16 space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Start an Agent Run</h1>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Ask the Agent to inspect Fairlx work, search repositories, plan sprints, or ship code changes.
            </p>
          </div>
          <AgentCommandInput showQuickActions placeholder="Plan, Build, / for skills, @ for context" />
        </div>
      </div>
    );
  }

  if (isLoading && !run) {
    return (
      <div className="relative h-full min-h-0 bg-background flex flex-col items-center justify-center text-sm text-muted-foreground pb-32">
        <Loader2 className="size-6 animate-spin text-primary mb-2" />
        <span>Loading workflow…</span>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="relative h-full min-h-0 bg-background flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground pb-32">
        <p>{error?.message || "Run not found."}</p>
        <Link href="/agent/dashboard">
          <Button variant="outline" size="sm">Back to Agent Home</Button>
        </Link>
      </div>
    );
  }

  const running = run.status === "running";
  const awaiting = run.status === "awaiting_confirmation";
  const awaitingPlugin = run.status === "awaiting_plugin";
  const awaitingQuestion = run.status === "awaiting_question";
  const statusLive = running || awaiting || awaitingPlugin || awaitingQuestion;
  const pinned = (harness?.chatMeta?.pinnedRunIds ?? []).includes(run.id);

  const saveTitle = () => {
    if (title.trim() && title.trim() !== run.title) {
      patchRun.mutate({ param: { runId: run.id }, json: { title: title.trim() } });
    }
    setRenaming(false);
  };

  return (
    <div className="h-full min-h-0 flex overflow-hidden bg-background">
      <DeleteDialog />
      {/* Center Chat & Stream View */}
      <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden bg-background">
        {/* Top Run Toolbar */}
        <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0 bg-card/60 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            {renaming ? (
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={saveTitle}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="text-base font-semibold text-foreground bg-transparent outline-none border-b border-primary px-1"
                autoFocus
              />
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-base font-semibold text-foreground truncate max-w-[320px]">{run.title}</h2>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground transition-colors p-1"
                  onClick={() => setRenaming(true)}
                  title="Rename"
                >
                  <Pencil className="size-3.5" />
                </button>
              </div>
            )}
            <div className="hidden sm:flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium text-[11px]",
                  statusLive
                    ? "bg-blue-500/10 text-blue-500"
                    : run.status === "completed"
                      ? "bg-green-500/10 text-green-500"
                      : "bg-destructive/10 text-destructive"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    statusLive ? "bg-blue-500 animate-pulse" : run.status === "completed" ? "bg-green-500" : "bg-destructive"
                  )}
                />
    <span className="capitalize">{running ? "Running" : awaiting ? "Needs approval" : awaitingPlugin ? "Needs plugin" : run.status === "awaiting_question" ? "Waiting for answer" : run.status}</span>
              </span>
              <span className="text-muted-foreground">• Started {relativeTime(run.createdAt)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {run.status === "failed" || run.status === "stopped" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={continueRun.isPending}
                onClick={() => continueRun.mutate({ runId: run.id })}
                className="h-8 text-xs font-medium gap-1.5"
              >
                <RotateCcw className="size-3.5" /> Retry
              </Button>
            ) : null}

            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => {
                const current = harness?.chatMeta?.pinnedRunIds ?? [];
                updateHarness.mutate({
                  json: {
                    chatMeta: {
                      pinnedRunIds: pinned ? current.filter((id) => id !== run.id) : [...current, run.id],
                      archivedRunIds: harness?.chatMeta?.archivedRunIds ?? [],
                    },
                  },
                });
              }}
              title={pinned ? "Unpin" : "Pin"}
            >
              <Pin className={cn("size-4", pinned && "fill-primary text-primary")} />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs font-medium text-muted-foreground hover:text-destructive"
              disabled={deleteRun.isPending}
              onClick={async () => {
                const ok = await confirmDelete();
                if (!ok) return;
                deleteRun.mutate(
                  { runId: run.id },
                  {
                    onSuccess: () => {
                      router.push("/agent/chats");
                    },
                  }
                );
              }}
              title="Delete run"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        {/* Messages Stream Scroll Area */}
        <div className="relative flex-1 min-h-0">
          <div
            ref={scrollerRef}
            className="absolute inset-0 overflow-y-auto custom-scrollbar px-6 py-6 pb-8"
            onScroll={(event) => {
              const target = event.currentTarget;
              const gap = target.scrollHeight - target.scrollTop - target.clientHeight;
              stickToBottomRef.current = gap < 80;
            }}
          >
            <AgentChatThread
              run={run}
              sending={sendMessage.isPending}
              isAccepting={confirmRun.isPending}
              isDenying={denyRun.isPending}
              onSendEdit={(content) => {
                stickToBottomRef.current = true;
                sendMessage.mutate({ param: { runId: run.id }, json: { content } });
              }}
              onPickChoice={(choice) => {
                stickToBottomRef.current = true;
                sendMessage.mutate({ param: { runId: run.id }, json: { content: choice } });
              }}
              onConfirm={() => confirmRun.mutate({ runId: run.id })}
              onDeny={() => denyRun.mutate({ runId: run.id })}
            />
          </div>

          <FloatingComposer>
            <AgentCommandInput
              run={run}
              variant="followup"
              showQuickActions={!awaiting && !awaitingPlugin && !running}
              submitting={sendMessage.isPending || awaiting || awaitingPlugin || running}
              placeholder={
                awaiting
                  ? "Accept or deny the pending action first"
                  : awaitingPlugin
                    ? "Connect a plugin to continue"
                  : run.kind === "training"
                    ? "Or write your own answer"
                    : "Plan, Build, / for skills, @ for context"
              }
              onFollowUp={(content) => {
                stickToBottomRef.current = true;
                sendMessage.mutate({ param: { runId: run.id }, json: { content } });
              }}
              onStop={() => stopRun.mutate({ runId: run.id })}
              isStopping={stopRun.isPending}
            />
          </FloatingComposer>
        </div>
      </div>

      {/* Right Sidebar: Context, Changes, Terminal, Preview (Positioned below navbar on the right side) */}
      <WorkflowSidebar run={run} events={run.events ?? []} tab={tab} onTab={setTab} />
    </div>
  );
}

export function WorkflowView() {
  return (
    <div className="h-full min-h-0 animate-in fade-in duration-200">
      <Suspense
        fallback={
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading workflow…</div>
        }
      >
        <WorkflowViewInner />
      </Suspense>
    </div>
  );
}
