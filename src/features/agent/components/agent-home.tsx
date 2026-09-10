"use client";

import Link from "next/link";

import { useCurrent } from "@/features/auth/api/use-current";
import { ProjectAvatar } from "@/features/projects/components/project-avatar";

import { useGetAgentContext } from "../api/use-agent-context";
import { useGetAgentHarness } from "../api/use-agent-harness";
import { firstName, greetingForNow } from "../lib/agent-ui";
import { isPersonalSessionMode } from "../lib/session-context";
import { AgentCommandInput } from "./agent-command-input";
import { AgentPageFrame } from "./agent-app-shell";
import { DailyCockpit, CockpitWorkItem } from "./daily-cockpit";
import { useAgentUi } from "./agent-ui-context";
import { useGetPersonalAgent } from "../api/use-personal-agent";
import { profileIsTrained } from "../lib/personal-agent-status";

export function AgentHome() {
  const { data: user } = useCurrent();
  const { data: context } = useGetAgentContext();
  const { data: harness } = useGetAgentHarness();
  const { data: personal } = useGetPersonalAgent();
  const { openRecentWork } = useAgentUi();
  const projects = context?.projects ?? [];
  const workItems = context?.workItems ?? [];
  const trained = profileIsTrained(personal?.profile);
  const personalUntrained = isPersonalSessionMode(harness?.settings.sessionMode) && !trained;

  return (
    <AgentPageFrame>
      <div className="max-w-[1280px] mx-auto grid lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_300px] gap-8 xl:gap-10 min-h-[calc(100vh-7.5rem)]">
        <div className="flex flex-col min-w-0">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">
              {greetingForNow()}, {firstName(user?.name, user?.email)}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {personalUntrained
                ? "Train your Personal Agent, then put it on the work that matters."
                : "Start a run, inspect work, or search code and docs."}
            </p>
          </div>

          <div className="my-auto pb-16 pt-8">
            <AgentCommandInput />
          </div>
        </div>

        <aside className="space-y-4 lg:pt-1">
          <DailyCockpit />

          <section className="rounded-2xl border border-border/70 bg-card p-4">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
                Projects
              </h3>
              <Link href="/agent/projects" className="text-[11px] text-muted-foreground hover:text-foreground">
                All
              </Link>
            </div>
            {projects.length === 0 ? (
              <p className="text-[12px] text-muted-foreground py-1">No projects yet.</p>
            ) : (
              <ul>
                {projects.slice(0, 5).map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/workspaces/${project.workspaceId}/projects/${project.id}`}
                      className="flex items-center gap-2.5 rounded-md py-1.5 hover:bg-muted/50 -mx-1 px-1 transition-colors"
                    >
                      <ProjectAvatar name={project.name} image={project.imageUrl} className="size-5 shrink-0" />
                      <span className="min-w-0 flex-1 text-[12px] text-foreground truncate">{project.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {trained ? null : (
            <section className="rounded-2xl border border-border/70 bg-card p-4">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
                  Assigned
                </h3>
                <button
                  type="button"
                  onClick={openRecentWork}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  All
                </button>
              </div>
              {workItems.length === 0 ? (
                <p className="text-[12px] text-muted-foreground py-1">Nothing assigned.</p>
              ) : (
                <ul className="space-y-2">
                  {workItems.slice(0, 5).map((item) => (
                    <li key={item.id}>
                      <CockpitWorkItem
                        task={{
                          id: item.id,
                          key: item.key,
                          title: item.title,
                          status: item.status,
                          priority: item.priority,
                          type: item.type,
                          workspaceId: item.workspaceId,
                          projectId: item.projectId,
                          dueAt: item.dueDate,
                          labels: item.labels,
                          flagged: item.flagged,
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </aside>
      </div>
    </AgentPageFrame>
  );
}
