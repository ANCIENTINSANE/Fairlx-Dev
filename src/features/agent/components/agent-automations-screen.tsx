"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Hash, MessageSquare, Play, Plus, Save, Slack, Trash2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { useGetAgentContext } from "../api/use-agent-context";
import { useGetAgentHarness, useUpdateAgentHarness } from "../api/use-agent-harness";
import { useRunAgentAutomation } from "../api/use-agent-search";
import { AGENT_FIELD_CLASS } from "../constants";
import { relativeTime } from "../lib/agent-ui";
import {
  automationTemplates,
  compactFlow,
  describeAutomation,
  emptyFlow,
  newNode,
  validateFlow,
} from "../lib/automation-flow";
import type { AgentAutomation, AutomationFlow } from "../types";
import { AgentPageFrame } from "./agent-app-shell";
import { AutomationFlowEditor } from "./automation-flow-editor";
import { SlackSetupGuide } from "./slack-setup-guide";

function newId() {
  return crypto.randomUUID();
}

function blankAutomation(name = "New loop"): AgentAutomation {
  const trigger = newNode("trigger", 40, 160);
  return {
    id: newId(),
    name,
    description: "",
    trigger: "",
    action: "",
    enabled: true,
    createdAt: new Date().toISOString(),
    flow: { version: 1, nodes: [trigger], edges: [] },
  };
}

export function AgentAutomationsScreen() {
  const router = useRouter();
  const { data: harness, isLoading } = useGetAgentHarness();
  const { data: context } = useGetAgentContext();
  const updateHarness = useUpdateAgentHarness();
  const runAutomation = useRunAgentAutomation();
  const automations = useMemo(() => harness?.automations ?? [], [harness?.automations]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentAutomation | null>(null);
  const [tab, setTab] = useState<"loops" | "channels">("loops");

  const selected = useMemo(() => automations.find((entry) => entry.id === selectedId) ?? null, [automations, selectedId]);

  useEffect(() => {
    if (!selectedId && automations.length) setSelectedId(automations[0].id);
  }, [automations, selectedId]);

  useEffect(() => {
    setDraft(selected ? { ...selected, flow: selected.flow ?? emptyFlow() } : null);
  }, [selected]);

  const dirty = Boolean(draft && selected && JSON.stringify(draft) !== JSON.stringify({ ...selected, flow: selected.flow ?? emptyFlow() }));

  const persist = (next: AgentAutomation[], message?: string, after?: () => void) => {
    updateHarness.mutate(
      { json: { automations: next.map((entry) => (entry.flow ? { ...entry, flow: compactFlow(entry.flow) } : entry)) } },
      {
        onSuccess: () => {
          if (message) toast.success(message);
          after?.();
        },
      },
    );
  };

  const addFromTemplate = (templateId?: string) => {
    const template = templateId ? automationTemplates().find((entry) => entry.id === templateId) : null;
    const created: AgentAutomation = template
      ? { ...blankAutomation(template.name), description: template.description, flow: template.flow }
      : blankAutomation();
    persist([...automations, created], "Loop added.", () => setSelectedId(created.id));
  };

  const saveDraft = () => {
    if (!draft) return;
    const problems = validateFlow(draft.flow);
    if (problems.length) {
      toast.error(problems[0]);
      return;
    }
    persist(automations.map((entry) => (entry.id === draft.id ? draft : entry)), "Loop saved.");
  };

  const remove = (id: string) => {
    persist(
      automations.filter((entry) => entry.id !== id),
      "Loop removed.",
      () => setSelectedId(null),
    );
  };

  const toggle = (id: string, enabled: boolean) => {
    persist(automations.map((entry) => (entry.id === id ? { ...entry, enabled } : entry)));
  };

  const runNow = (automation: AgentAutomation) => {
    runAutomation.mutate(
      { automationId: automation.id },
      {
        onSuccess: (result) => {
          toast.success("Loop started.");
          router.push(`/agent/workflow?runId=${result.data.id}`);
        },
      },
    );
  };

  const slack = (context?.integrations ?? []).filter((entry) => /slack/i.test(entry.provider || ""));
  const discord = (context?.integrations ?? []).filter((entry) => /discord/i.test(entry.provider || ""));
  const teams = (context?.integrations ?? []).filter((entry) => /teams/i.test(entry.provider || ""));

  return (
    <AgentPageFrame>
      <div className="mx-auto max-w-[1500px] space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Automations</h1>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Loops that run without you: a bug is raised → Fairlx fixes it in the sandbox → tests → PR → the channel and a supervisor hear about it.
              Build them as nodes; trigger them from work items, comments, or Slack.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 text-xs">
            <button type="button" onClick={() => setTab("loops")} className={cn("rounded-md px-3 py-1.5 font-medium", tab === "loops" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              Loops
            </button>
            <button type="button" onClick={() => setTab("channels")} className={cn("rounded-md px-3 py-1.5 font-medium", tab === "channels" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              Channels &amp; Slack
            </button>
          </div>
        </div>

        {tab === "channels" ? (
          <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-3">
              <ChannelCard icon={Slack} name="Slack" rows={slack} hint="Slash commands, @Fairlx thread replies, notifications." />
              <ChannelCard icon={MessageSquare} name="Discord" rows={discord} hint="/fairlx create and @Fairlx mentions via interactions." />
              <ChannelCard icon={Hash} name="Microsoft Teams" rows={teams} hint="Outgoing webhook → /api/integrations/teams/webhook." />
              <p className="text-[11px] text-muted-foreground">
                Channels are connected per project under <span className="font-medium text-foreground">Project → Settings → Integrations</span>. Loops use the linked project’s default channel unless a node names another.
              </p>
            </div>
            <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Configure Slack to control Fairlx</h2>
              <SlackSetupGuide />
            </section>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="space-y-3">
              <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your loops</p>
                  <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => addFromTemplate()} disabled={updateHarness.isPending}>
                    <Plus className="size-3.5" /> New
                  </Button>
                </div>
                {isLoading ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
                ) : automations.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">No loops yet — start from a template below.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {automations.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(entry.id)}
                          className={cn(
                            "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                            entry.id === selectedId ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className={cn("size-2 rounded-full", entry.enabled ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                            <span className="truncate text-sm font-medium text-foreground">{entry.name}</span>
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{describeAutomation(entry) || "Free-text automation"}</p>
                          {entry.lastRunAt ? (
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              Ran {entry.runCount || 1}× · last {relativeTime(entry.lastRunAt)}
                            </p>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Templates</p>
                <ul className="space-y-1.5">
                  {automationTemplates().map((template) => (
                    <li key={template.id}>
                      <button
                        type="button"
                        onClick={() => addFromTemplate(template.id)}
                        disabled={updateHarness.isPending}
                        className="w-full rounded-lg border border-dashed border-border px-3 py-2 text-left hover:bg-muted/50"
                      >
                        <p className="text-sm font-medium text-foreground">{template.name}</p>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{template.description}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>

            <section className="space-y-3">
              {draft ? (
                <>
                  <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="min-w-[200px] flex-1 space-y-1.5">
                      <Label htmlFor="loop-name" className="text-[11px] text-muted-foreground">Name</Label>
                      <Input id="loop-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={AGENT_FIELD_CLASS} />
                    </div>
                    <div className="min-w-[200px] flex-1 space-y-1.5">
                      <Label htmlFor="loop-project" className="text-[11px] text-muted-foreground">Only for project (blank = all)</Label>
                      <select
                        id="loop-project"
                        className={cn("h-10 w-full rounded-md px-3 text-sm outline-none", AGENT_FIELD_CLASS)}
                        value={draft.projectId || ""}
                        onChange={(event) => {
                          const project = (context?.projects ?? []).find((entry) => entry.id === event.target.value);
                          setDraft({ ...draft, projectId: event.target.value || undefined, workspaceId: project?.workspaceId || undefined });
                        }}
                      >
                        <option value="">All projects</option>
                        {(context?.projects ?? []).map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label className="flex items-center gap-2 pb-2 text-xs text-foreground">
                      <Switch checked={draft.enabled} onCheckedChange={(enabled) => { setDraft({ ...draft, enabled }); toggle(draft.id, enabled); }} />
                      {draft.enabled ? "Enabled" : "Paused"}
                    </label>
                    <div className="flex items-center gap-2 pb-0.5">
                      <Button type="button" size="sm" variant="outline" className="h-9 gap-1" disabled={runAutomation.isPending || dirty} title={dirty ? "Save first" : "Run this loop now"} onClick={() => runNow(draft)}>
                        <Play className="size-3.5" /> Run now
                      </Button>
                      <Button type="button" size="sm" className="h-9 gap-1" disabled={!dirty || updateHarness.isPending} onClick={saveDraft}>
                        <Save className="size-3.5" /> {updateHarness.isPending ? "Saving…" : "Save"}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-9 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => remove(draft.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  <AutomationFlowEditor flow={draft.flow ?? emptyFlow()} onChange={(flow: AutomationFlow) => setDraft({ ...draft, flow })} />
                  <p className="text-[11px] text-muted-foreground">
                    When this loop fires it opens an autonomous run in <Link href="/agent/workflow" className="underline">Workflow</Link>. Supervisors get a Fairlx notification (and Slack, if chosen) on start, failure, and completion.
                  </p>
                </>
              ) : (
                <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center shadow-sm">
                  <Zap className="mb-2 size-6 text-primary" />
                  <p className="text-sm font-semibold text-foreground">Pick a loop or start from a template</p>
                  <p className="mt-1 max-w-md text-xs text-muted-foreground">
                    “Bug → fix → test → PR” is the classic: any new BUG makes Fairlx reproduce, fix, retry on failing tests, open the PR, and post to Slack while the supervisor watches.
                  </p>
                  <Button type="button" size="sm" className="mt-4 gap-1" onClick={() => addFromTemplate("bug-fix-loop")} disabled={updateHarness.isPending}>
                    <Bot className="size-3.5" /> Add the bug-fix loop
                  </Button>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </AgentPageFrame>
  );
}

function ChannelCard({
  icon: Icon,
  name,
  rows,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  rows: Array<{ id: string; projectId?: string; name?: string }>;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">{name}</p>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", rows.length ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground")}>
          {rows.length ? `${rows.length} project${rows.length === 1 ? "" : "s"} linked` : "Not connected"}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      {rows.length ? (
        <ul className="mt-2 space-y-0.5">
          {rows.map((row) => (
            <li key={row.id} className="truncate text-[11px] text-foreground">
              {row.name || row.projectId}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
