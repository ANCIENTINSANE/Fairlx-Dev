"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Briefcase, Code, Folder, FolderPlus, FolderX, GitBranch, Plus, Check, ChevronDown } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCreateProject } from "@/features/projects/api/use-create-project";
import { cn } from "@/lib/utils";

import { useGetAgentContext } from "../api/use-agent-context";
import { useGetAgentHarness, useUpdateAgentHarness } from "../api/use-agent-harness";
import { usePatchAgentRun } from "../api/use-agent-runs";
import { AGENT_CONTEXT_QUERY_KEY } from "../constants";
import type { AgentRun } from "../types";
import { extractBoardProject } from "../lib/project-launch";
import { useAgentUi } from "./agent-ui-context";
import { GitHubAddOneButton } from "@/features/github-integration/components";
import { AgentWorkingDropUp } from "./agent-run-hud";
import { AgentFace, useAgentFaceMood } from "./agent-face";
import { isPersonalSessionMode } from "../lib/session-context";

export function AgentScopeBar({
  run,
  onScopeChange,
  defaultWorkspaceId,
  defaultProjectId,
  composerTyping = false,
  composerListening = false,
  composerGazeProgress = 0.5,
}: {
  run?: AgentRun;
  onScopeChange?: (workspaceId: string, projectId?: string) => void;
  defaultWorkspaceId?: string;
  defaultProjectId?: string;
  composerTyping?: boolean;
  composerListening?: boolean;
  composerGazeProgress?: number;
} = {}) {
  const { data: context } = useGetAgentContext();
  const { data: harness } = useGetAgentHarness();
  const { openNewWorkspace } = useAgentUi();
  const updateHarness = useUpdateAgentHarness();
  const patchRun = usePatchAgentRun();
  const createProject = useCreateProject();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [overrideProjectId, setOverrideProjectId] = useState<string | null | undefined>(undefined);
  const [pendingProject, setPendingProject] = useState<{
    id?: string;
    workspaceId?: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    setOverrideProjectId(undefined);
  }, [run?.id]);

  const workspaces = useMemo(() => context?.workspaces ?? [], [context?.workspaces]);
  const launch = useMemo(() => extractBoardProject(run?.messages ?? []), [run?.messages]);
  const workspaceId =
    run?.workspaceId || launch?.workspaceId || defaultWorkspaceId || harness?.settings.defaultWorkspaceId || workspaces[0]?.id;
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const projects = useMemo(() => {
    const list = (context?.projects ?? []).filter((item) => !workspaceId || item.workspaceId === workspaceId);
    if (launch?.projectId && !list.some((item) => item.id === launch.projectId)) {
      list.unshift({
        id: launch.projectId,
        name: launch.name || "Project",
        workspaceId: launch.workspaceId || workspaceId || "",
      } as (typeof list)[number]);
    }
    return list;
  }, [context?.projects, workspaceId, launch]);
  const inheritedProjectId =
    run?.projectId || launch?.projectId || defaultProjectId || harness?.settings.defaultProjectId;
  const projectId = overrideProjectId === undefined ? inheritedProjectId : overrideProjectId || undefined;
  const project = projects.find((item) => item.id === projectId) ?? context?.projects.find((item) => item.id === projectId);
  const projectLabel = project?.name || (projectId ? launch?.name || "Project" : "No project");
  const repo = (context?.githubRepos ?? []).find(
    (item) => item.projectId === project?.id || (!project && item.workspaceId === workspaceId),
  );
  const personal = isPersonalSessionMode(harness?.settings.sessionMode);
  const faceMood = useAgentFaceMood(run, { typing: composerTyping, listening: composerListening });
  const q = search.trim().toLowerCase();
  const filteredWorkspaces = useMemo(
    () => workspaces.filter((item) => !q || item.name.toLowerCase().includes(q)),
    [workspaces, q],
  );
  const filteredProjects = useMemo(
    () => projects.filter((item) => !q || item.name.toLowerCase().includes(q)),
    [projects, q],
  );

  const selectWorkspace = (id: string) => {
    const stillValid = (context?.projects ?? []).some(
      (item) => item.id === projectId && item.workspaceId === id,
    );
    const nextProjectId = stillValid ? projectId : undefined;
    if (!stillValid) setOverrideProjectId(null);
    updateHarness.mutate({
      json: {
        settings: {
          defaultWorkspaceId: id,
          defaultProjectId: nextProjectId || "",
        },
      },
    });
    if (run?.id) {
      patchRun.mutate({
        param: { runId: run.id },
        json: {
          workspaceId: id,
          projectId: nextProjectId || "",
        },
      });
    }
    onScopeChange?.(id, nextProjectId);
    setWorkspaceOpen(false);
    setSearch("");
  };

  const applyProjectChange = (id: string | undefined, nextWorkspaceId?: string) => {
    const targetWorkspaceId = nextWorkspaceId || workspaceId;
    setOverrideProjectId(id || null);
    updateHarness.mutate({
      json: {
        settings: {
          defaultWorkspaceId: targetWorkspaceId,
          defaultProjectId: id || "",
        },
      },
    });
    if (run?.id) {
      patchRun.mutate({
        param: { runId: run.id },
        json: {
          projectId: id || "",
          ...(targetWorkspaceId ? { workspaceId: targetWorkspaceId } : {}),
        },
      });
    }
    onScopeChange?.(targetWorkspaceId || "", id);
    setProjectOpen(false);
    setSearch("");
  };

  const requestProjectChange = (id: string | undefined, nextWorkspaceId?: string, name?: string) => {
    if ((id || "") === (projectId || "")) {
      setProjectOpen(false);
      setSearch("");
      return;
    }
    if (run?.id) {
      setPendingProject({
        id,
        workspaceId: nextWorkspaceId || workspaceId,
        name: name || (id ? "a different project" : "No project"),
      });
      setProjectOpen(false);
      setSearch("");
      return;
    }
    applyProjectChange(id, nextWorkspaceId);
  };

  const confirmNewChatForProject = () => {
    if (!pendingProject) return;
    const nextId = pendingProject.id;
    const targetWorkspaceId = pendingProject.workspaceId || workspaceId;
    updateHarness.mutate({
      json: {
        settings: {
          defaultWorkspaceId: targetWorkspaceId,
          defaultProjectId: nextId || "",
        },
      },
    });
    onScopeChange?.(targetWorkspaceId || "", nextId);
    setPendingProject(null);
    router.push("/agent/dashboard");
  };

  return (
    <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1 pb-1.5 bg-background">
      <div className="flex items-center gap-1 min-w-0">
        <ScopeMenu
        open={workspaceOpen}
        onOpenChange={(next) => {
          setWorkspaceOpen(next);
          setSearch("");
        }}
        label={workspace?.name || "Workspace"}
        icon={Briefcase}
        searchPlaceholder="Search workspaces..."
        search={search}
        onSearch={setSearch}
      >
        {filteredWorkspaces.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => selectWorkspace(item.id)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left"
          >
            <Folder className="size-3.5 text-muted-foreground" />
            <span className="flex-1 truncate text-foreground font-medium">{item.name}</span>
            {item.id === workspaceId ? <Check className="size-3 text-primary" /> : null}
          </button>
        ))}
        <div className="h-px bg-border my-1" />
        <button
          type="button"
          onClick={() => {
            setWorkspaceOpen(false);
            openNewWorkspace();
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left text-foreground font-medium"
        >
          <Plus className="size-3.5 text-primary" />
          <span>New workspace</span>
        </button>
      </ScopeMenu>

      <span className="text-muted-foreground/50">/</span>

      <ScopeMenu
        open={projectOpen}
        onOpenChange={(next) => {
          setProjectOpen(next);
          setSearch("");
          setNewName("");
        }}
        label={projectLabel}
        icon={projectId ? Code : FolderX}
        searchPlaceholder="Search folders, projects..."
        search={search}
        onSearch={setSearch}
      >
        {(!q || "no project".includes(q) || "none".includes(q)) ? (
          <button
            type="button"
            onClick={() => requestProjectChange(undefined, workspaceId, "No project")}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left"
          >
            <FolderX className="size-3.5 text-muted-foreground" />
            <span className="flex-1 truncate text-muted-foreground font-medium">No project</span>
            {!projectId ? <Check className="size-3 text-primary" /> : null}
          </button>
        ) : null}
        {filteredProjects.length ? <div className="h-px bg-border my-1" /> : null}
        {filteredProjects.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => requestProjectChange(item.id, item.workspaceId, item.name)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left"
          >
            <Folder className="size-3.5 text-muted-foreground" />
            <span className="flex-1 truncate text-foreground font-medium">{item.name}</span>
            {item.id === projectId ? <Check className="size-3 text-primary" /> : null}
          </button>
        ))}
        <div className="h-px bg-border my-1" />
        <form
          className="px-3 py-2 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!newName.trim() || !workspaceId) return;
            createProject.mutate(
              { form: { name: newName.trim(), workspaceId } },
              {
                onSuccess: (result) => {
                  queryClient.invalidateQueries({ queryKey: AGENT_CONTEXT_QUERY_KEY });
                  const created = (result as { data?: { $id?: string } }).data;
                  if (created?.$id) requestProjectChange(created.$id, workspaceId, newName.trim());
                  setNewName("");
                },
              },
            );
          }}
        >
          <FolderPlus className="size-3.5 text-muted-foreground shrink-0" />
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New project"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground text-foreground"
          />
        </form>
      </ScopeMenu>

      {repo ? (
        <>
          <span className="text-muted-foreground/50">/</span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-muted transition-colors text-foreground">
            <GitBranch className="size-3 text-muted-foreground" />
            {repo.branch || "main"}
          </span>
        </>
      ) : project && workspaceId ? (
        <>
          <span className="text-muted-foreground/50">/</span>
          <GitHubAddOneButton
            projectId={project.id}
            workspaceId={workspaceId}
            className="h-6 px-2 text-[11px] font-medium"
          />
        </>
      ) : null}
      {personal ? <AgentFace mood={faceMood} size={32} gazeProgress={composerGazeProgress} className="ml-1" /> : null}
      </div>

      <div className="flex items-center gap-1 shrink-0 ml-auto">
        <AgentWorkingDropUp run={run} />
      </div>

      <AlertDialog open={pendingProject !== null} onOpenChange={(open) => !open && setPendingProject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start a new chat?</AlertDialogTitle>
            <AlertDialogDescription>
              Switching to {pendingProject?.name || "a different project"} starts a new chat session. This
              conversation stays with the current project, and you can reopen it from Recent Runs anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep this chat</AlertDialogCancel>
            <AlertDialogAction onClick={confirmNewChatForProject}>Start new chat</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ScopeMenu({
  open,
  onOpenChange,
  label,
  icon: Icon,
  searchPlaceholder,
  search,
  onSearch,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  searchPlaceholder: string;
  search: string;
  onSearch: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-muted hover:text-foreground max-w-[160px] font-medium transition-colors",
          )}
        >
          <Icon className="size-3 text-muted-foreground" />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-2.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-0 bg-popover border-border text-popover-foreground shadow-xl rounded-xl">
        <div className="px-3 py-2 border-b border-border">
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
        <div className="py-1 max-h-64 overflow-y-auto custom-scrollbar">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
