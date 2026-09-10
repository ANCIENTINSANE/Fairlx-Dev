"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bell,
  Bot,
  CheckCircle2,
  FlaskConical,
  Rocket,
  ShieldCheck,
  Trash2,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { AGENT_FIELD_CLASS } from "../constants";
import {
  AUTOMATION_NOTIFY_CHANNELS,
  AUTOMATION_TRIGGER_KINDS,
  newEdge,
  newNode,
  nodeTitle,
  validateFlow,
} from "../lib/automation-flow";
import type { AutomationEdge, AutomationFlow, AutomationNode, AutomationNodeKind } from "../types";

type LoopNodeData = {
  kind: AutomationNodeKind;
  title: string;
  summary: string;
  onDelete?: (id: string) => void;
};

const KIND_STYLE: Record<AutomationNodeKind, { icon: typeof Zap; color: string; ring: string }> = {
  trigger: { icon: Zap, color: "#f59e0b", ring: "border-amber-400" },
  agent: { icon: Bot, color: "#6366f1", ring: "border-indigo-400" },
  test: { icon: FlaskConical, color: "#0ea5e9", ring: "border-sky-400" },
  deploy: { icon: Rocket, color: "#10b981", ring: "border-emerald-400" },
  notify: { icon: Bell, color: "#ec4899", ring: "border-pink-400" },
  supervisor: { icon: ShieldCheck, color: "#8b5cf6", ring: "border-violet-400" },
  close: { icon: CheckCircle2, color: "#64748b", ring: "border-slate-400" },
};

function summarize(node: AutomationNode): string {
  const cfg = node.config;
  switch (node.kind) {
    case "trigger": {
      const kind = AUTOMATION_TRIGGER_KINDS.find((entry) => entry.id === String(cfg.kind))?.label || String(cfg.kind || "");
      const types = Array.isArray(cfg.itemTypes) ? cfg.itemTypes.join(", ") : "";
      return `${kind}${types ? ` · ${types}` : ""}`;
    }
    case "agent":
      return String(cfg.prompt || "").slice(0, 70) || "Fix or implement the item";
    case "test":
      return `${String(cfg.command || "npm test")} · retry ×${Number(cfg.maxRetries ?? 2)}`;
    case "deploy":
      return String(cfg.command || "") || (String(cfg.mode || "open_pr") === "merge_pr" ? "Open + merge PR" : String(cfg.mode) === "push_branch" ? "Push branch" : "Open pull request");
    case "notify":
      return `${String(cfg.channel || "slack")}${cfg.target ? ` → ${String(cfg.target)}` : ""}`;
    case "supervisor":
      return `${String(cfg.target || "harness owner")}${cfg.requireApproval ? " · approval required" : ""}`;
    case "close":
      return `Status → ${String(cfg.status || "DONE")}`;
    default:
      return "";
  }
}

const LoopNode = memo(({ id, data, selected }: NodeProps<Node<LoopNodeData>>) => {
  const style = KIND_STYLE[data.kind];
  const Icon = style.icon;
  const twoOutputs = data.kind === "test" || data.kind === "deploy";
  return (
    <div
      className={cn(
        "group relative w-[220px] rounded-xl border-2 bg-card shadow-sm transition-all",
        style.ring,
        selected ? "ring-2 ring-primary ring-offset-2" : "hover:shadow-md",
      )}
    >
      {data.kind !== "trigger" ? (
        <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-background !bg-muted-foreground/60" />
      ) : null}
      <div className="flex items-start gap-2 p-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-white" style={{ background: style.color }}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">{data.title}</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{data.summary}</p>
        </div>
        {data.onDelete ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onDelete?.(id);
            }}
            className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
            aria-label="Remove node"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>
      {twoOutputs ? (
        <>
          <Handle id="pass" type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-background !bg-emerald-500" />
          <span className="pointer-events-none absolute -right-9 top-1/2 -translate-y-1/2 text-[10px] font-medium text-emerald-600">pass</span>
          <Handle id="fail" type="source" position={Position.Bottom} className="!h-3 !w-3 !border-2 !border-background !bg-rose-500" />
          <span className="pointer-events-none absolute -bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-medium text-rose-600">fail</span>
        </>
      ) : (
        <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-background !bg-muted-foreground/60" />
      )}
    </div>
  );
});
LoopNode.displayName = "LoopNode";

const nodeTypes = { loopNode: LoopNode };

function toRfNodes(flow: AutomationFlow, onDelete: (id: string) => void): Node<LoopNodeData>[] {
  return flow.nodes.map((node) => ({
    id: node.id,
    type: "loopNode",
    position: { x: node.x, y: node.y },
    data: { kind: node.kind, title: node.label || nodeTitle(node.kind), summary: summarize(node), onDelete: node.kind === "trigger" ? undefined : onDelete },
  }));
}

function toRfEdges(flow: AutomationFlow): Edge[] {
  return flow.edges.map((edge) => {
    const fail = edge.when === "fail";
    const pass = edge.when === "pass";
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      sourceHandle: fail ? "fail" : pass ? "pass" : undefined,
      type: fail ? "smoothstep" : "default",
      animated: fail,
      label: fail ? "on fail" : pass ? "on pass" : undefined,
      labelStyle: { fontSize: 10 },
      style: { stroke: fail ? "#f43f5e" : pass ? "#10b981" : "#94a3b8", strokeWidth: 1.6 },
      markerEnd: { type: MarkerType.ArrowClosed, color: fail ? "#f43f5e" : pass ? "#10b981" : "#94a3b8" },
    };
  });
}

export function AutomationFlowEditor({
  flow,
  onChange,
  readOnly = false,
  className,
}: {
  flow: AutomationFlow;
  onChange: (flow: AutomationFlow) => void;
  readOnly?: boolean;
  className?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const removeNode = useCallback(
    (id: string) => {
      onChange({
        ...flow,
        nodes: flow.nodes.filter((node) => node.id !== id),
        edges: flow.edges.filter((edge) => edge.from !== id && edge.to !== id),
      });
      setSelectedId((current) => (current === id ? null : current));
    },
    [flow, onChange],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<LoopNodeData>>(toRfNodes(flow, removeNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toRfEdges(flow));

  useEffect(() => {
    setNodes(toRfNodes(flow, removeNode));
    setEdges(toRfEdges(flow));
  }, [flow, removeNode, setEdges, setNodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly || !connection.source || !connection.target || connection.source === connection.target) return;
      const when: AutomationEdge["when"] =
        connection.sourceHandle === "fail" ? "fail" : connection.sourceHandle === "pass" ? "pass" : "always";
      const edge = newEdge(connection.source, connection.target, when);
      setEdges((current) => addEdge({ id: edge.id, ...connection }, current));
      onChange({ ...flow, edges: [...flow.edges, edge] });
    },
    [flow, onChange, readOnly, setEdges],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (readOnly) return;
      onChange({
        ...flow,
        nodes: flow.nodes.map((entry) => (entry.id === node.id ? { ...entry, x: node.position.x, y: node.position.y } : entry)),
      });
    },
    [flow, onChange, readOnly],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (readOnly || !deleted.length) return;
      const gone = new Set(deleted.map((edge) => edge.id));
      onChange({ ...flow, edges: flow.edges.filter((edge) => !gone.has(edge.id)) });
    },
    [flow, onChange, readOnly],
  );

  const addNode = (kind: AutomationNodeKind) => {
    if (readOnly) return;
    if (kind === "trigger" && flow.nodes.some((node) => node.kind === "trigger")) return;
    const rightMost = flow.nodes.reduce((max, node) => Math.max(max, node.x), 0);
    const node = newNode(kind, flow.nodes.length ? rightMost + 280 : 40, kind === "supervisor" ? 320 : 160);
    onChange({ ...flow, nodes: [...flow.nodes, node] });
    setSelectedId(node.id);
  };

  const selected = useMemo(() => flow.nodes.find((node) => node.id === selectedId) ?? null, [flow.nodes, selectedId]);
  const updateSelected = (config: AutomationNode["config"]) => {
    if (!selected) return;
    onChange({ ...flow, nodes: flow.nodes.map((node) => (node.id === selected.id ? { ...node, config: { ...node.config, ...config } } : node)) });
  };
  const problems = validateFlow(flow);

  return (
    <div className={cn("grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]", className)}>
      <div className="flex min-h-[460px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-2">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Add node</span>
          {(["trigger", "agent", "test", "deploy", "notify", "supervisor", "close"] as AutomationNodeKind[]).map((kind) => {
            const Icon = KIND_STYLE[kind].icon;
            const disabled = readOnly || (kind === "trigger" && flow.nodes.some((node) => node.kind === "trigger"));
            return (
              <Button key={kind} type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={disabled} onClick={() => addNode(kind)}>
                <Icon className="size-3.5" style={{ color: KIND_STYLE[kind].color }} />
                {nodeTitle(kind)}
              </Button>
            );
          })}
          <span className="ml-auto text-[11px] text-muted-foreground">Drag from a node’s right handle to connect · bottom red handle = on fail</span>
        </div>
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onEdgesDelete={onEdgesDelete}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable
            deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        {problems.length ? (
          <div className="border-t border-border bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {problems.join(" ")}
          </div>
        ) : null}
      </div>
      <NodeInspector node={selected} readOnly={readOnly} onChange={updateSelected} />
    </div>
  );
}

function listField(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : String(value || "");
}

function parseList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
}

function NodeInspector({
  node,
  readOnly,
  onChange,
}: {
  node: AutomationNode | null;
  readOnly: boolean;
  onChange: (config: AutomationNode["config"]) => void;
}) {
  if (!node) {
    return (
      <aside className="rounded-xl border border-dashed border-border bg-card/50 p-4 text-xs text-muted-foreground">
        Select a node to edit it. A loop reads left to right: <span className="font-medium text-foreground">Trigger → Fairlx agent → Run tests → Deploy / PR → Notify</span>.
        Connect the red <span className="font-medium text-rose-600">fail</span> handle of “Run tests” back to the agent to make it retry. Add a <span className="font-medium text-foreground">Supervisor</span> to keep one person informed and, optionally, require approval before merge.
      </aside>
    );
  }
  const cfg = node.config;
  const selectClass = cn("h-9 w-full rounded-md px-2 text-sm outline-none", AGENT_FIELD_CLASS);
  return (
    <aside className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md text-white" style={{ background: KIND_STYLE[node.kind].color }}>
          {(() => {
            const Icon = KIND_STYLE[node.kind].icon;
            return <Icon className="size-3.5" />;
          })()}
        </span>
        <p className="font-semibold text-foreground">{nodeTitle(node.kind)}</p>
      </div>

      {node.kind === "trigger" ? (
        <>
          <Field label="Fires when">
            <select className={selectClass} disabled={readOnly} value={String(cfg.kind || "work_item_created")} onChange={(event) => onChange({ kind: event.target.value })}>
              {AUTOMATION_TRIGGER_KINDS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">{AUTOMATION_TRIGGER_KINDS.find((entry) => entry.id === String(cfg.kind))?.hint}</p>
          </Field>
          <Field label="Item types (blank = any)">
            <Input className={AGENT_FIELD_CLASS} disabled={readOnly} placeholder="BUG, ISSUE" defaultValue={listField(cfg.itemTypes)} onBlur={(event) => onChange({ itemTypes: parseList(event.target.value) })} />
          </Field>
          <Field label="Priorities (blank = any)">
            <Input className={AGENT_FIELD_CLASS} disabled={readOnly} placeholder="URGENT, HIGH" defaultValue={listField(cfg.priorities)} onBlur={(event) => onChange({ priorities: parseList(event.target.value) })} />
          </Field>
          {String(cfg.kind) === "work_item_status" ? (
            <Field label="Statuses">
              <Input className={AGENT_FIELD_CLASS} disabled={readOnly} placeholder="READY, TODO" defaultValue={listField(cfg.statuses)} onBlur={(event) => onChange({ statuses: parseList(event.target.value) })} />
            </Field>
          ) : null}
          <Field label="Keyword filter (optional)">
            <Input className={AGENT_FIELD_CLASS} disabled={readOnly} placeholder="checkout" defaultValue={String(cfg.keyword || "")} onBlur={(event) => onChange({ keyword: event.target.value })} />
          </Field>
        </>
      ) : null}

      {node.kind === "agent" ? (
        <>
          <Field label="Instructions for Fairlx">
            <Textarea className={cn("min-h-[120px] text-sm", AGENT_FIELD_CLASS)} disabled={readOnly} defaultValue={String(cfg.prompt || "")} onBlur={(event) => onChange({ prompt: event.target.value })} />
            <p className="mt-1 text-[11px] text-muted-foreground">Placeholders: {"{{key}} {{title}} {{type}} {{text}}"}</p>
          </Field>
          <Toggle label="Autonomous (skip every Accept)" checked={cfg.autoMode !== false} disabled={readOnly} onChange={(value) => onChange({ autoMode: value })} />
        </>
      ) : null}

      {node.kind === "test" ? (
        <>
          <Field label="Test command (runs in /workspace)">
            <Input className={AGENT_FIELD_CLASS} disabled={readOnly} defaultValue={String(cfg.command || "")} placeholder="npm test -- --run" onBlur={(event) => onChange({ command: event.target.value })} />
          </Field>
          <Field label="Max fix retries on failure">
            <Input className={AGENT_FIELD_CLASS} disabled={readOnly} type="number" min={0} max={5} defaultValue={Number(cfg.maxRetries ?? 2)} onBlur={(event) => onChange({ maxRetries: Math.max(0, Math.min(5, Number(event.target.value) || 0)) })} />
          </Field>
        </>
      ) : null}

      {node.kind === "deploy" ? (
        <>
          <Field label="Mode">
            <select className={selectClass} disabled={readOnly} value={String(cfg.mode || "open_pr")} onChange={(event) => onChange({ mode: event.target.value })}>
              <option value="open_pr">Push branch + open PR</option>
              <option value="merge_pr">Open PR and merge when green</option>
              <option value="push_branch">Push branch only</option>
            </select>
          </Field>
          <Field label="Custom deploy command (optional, overrides mode)">
            <Input className={AGENT_FIELD_CLASS} disabled={readOnly} placeholder="npm run deploy" defaultValue={String(cfg.command || "")} onBlur={(event) => onChange({ command: event.target.value })} />
          </Field>
        </>
      ) : null}

      {node.kind === "notify" ? (
        <>
          <Field label="Channel">
            <select className={selectClass} disabled={readOnly} value={String(cfg.channel || "slack")} onChange={(event) => onChange({ channel: event.target.value })}>
              {AUTOMATION_NOTIFY_CHANNELS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Target (channel, #name, or email — blank = project default)">
            <Input className={AGENT_FIELD_CLASS} disabled={readOnly} placeholder="#engineering" defaultValue={String(cfg.target || "")} onBlur={(event) => onChange({ target: event.target.value })} />
          </Field>
          <Field label="Message">
            <Textarea className={cn("min-h-[80px] text-sm", AGENT_FIELD_CLASS)} disabled={readOnly} defaultValue={String(cfg.message || "")} onBlur={(event) => onChange({ message: event.target.value })} />
          </Field>
        </>
      ) : null}

      {node.kind === "supervisor" ? (
        <>
          <Field label="Who to keep informed (Fairlx user id, email, or #slack-channel; blank = you)">
            <Input className={AGENT_FIELD_CLASS} disabled={readOnly} placeholder="lead@company.com" defaultValue={String(cfg.target || "")} onBlur={(event) => onChange({ target: event.target.value })} />
          </Field>
          <Field label="Also send via">
            <select className={selectClass} disabled={readOnly} value={String(cfg.channel || "in_app")} onChange={(event) => onChange({ channel: event.target.value })}>
              {AUTOMATION_NOTIFY_CHANNELS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notify on">
            <Input className={AGENT_FIELD_CLASS} disabled={readOnly} placeholder="start, fail, done" defaultValue={listField(cfg.notifyOn).toLowerCase()} onBlur={(event) => onChange({ notifyOn: parseList(event.target.value).map((entry) => entry.toLowerCase()) })} />
          </Field>
          <Toggle label="Require approval before merge / close" checked={cfg.requireApproval === true} disabled={readOnly} onChange={(value) => onChange({ requireApproval: value })} />
        </>
      ) : null}

      {node.kind === "close" ? (
        <>
          <Field label="Set status to">
            <Input className={AGENT_FIELD_CLASS} disabled={readOnly} defaultValue={String(cfg.status || "DONE")} onBlur={(event) => onChange({ status: event.target.value.toUpperCase().replace(/\s+/g, "_") })} />
          </Field>
          <Field label="Comment">
            <Input className={AGENT_FIELD_CLASS} disabled={readOnly} defaultValue={String(cfg.comment || "")} onBlur={(event) => onChange({ comment: event.target.value })} />
          </Field>
        </>
      ) : null}
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <span className="text-xs text-foreground">{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
