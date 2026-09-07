"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Plug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useConnectAgentPlugin, useGetAgentPlugins } from "../api/use-agent-plugins";
import { useContinueAgentRun } from "../api/use-agent-runs";
import { catalogForCapability, type AgentPendingPlugin } from "../plugins/catalog";
import { AGENT_FIELD_CLASS } from "../constants";
import { cn } from "@/lib/utils";
import { PluginCredentialGuide, hasPluginCredentialGuide } from "./plugin-credential-guide";
import { useGetOAuthStatus } from "@/features/github-integration/api/use-github";

function isOauthMail(id: string) {
  return id === "outlook" || id === "gmail";
}

function isGithubPlugin(id: string) {
  return id === "github";
}

export function PluginConnectCard({
  pending,
  runId,
  alreadyGranted,
  projectId,
}: {
  pending: AgentPendingPlugin;
  runId?: string;
  alreadyGranted?: boolean;
  projectId?: string;
}) {
  const { data } = useGetAgentPlugins();
  const connect = useConnectAgentPlugin();
  const continueRun = useContinueAgentRun();
  const { data: githubOauth } = useGetOAuthStatus();
  const githubOauthConfigured = githubOauth?.oauthConfigured ?? false;
  const resumed = useRef(false);

  useEffect(() => {
    if (!alreadyGranted || !runId || resumed.current) return;
    resumed.current = true;
    continueRun.mutate({ runId });
  }, [alreadyGranted, runId, continueRun]);

  const options = useMemo(() => {
    const fromPending = (data?.catalog ?? []).filter((item) => pending.catalogIds.includes(item.id));
    return fromPending.length ? fromPending : catalogForCapability(pending.capability);
  }, [data?.catalog, pending]);
  const [catalogId, setCatalogId] = useState(options[0]?.id ?? pending.catalogIds[0] ?? "outlook");
  const selected = options.find((item) => item.id === catalogId) ?? options[0];
  const [fields, setFields] = useState<Record<string, string>>({});
  const firstSecretIndex = selected?.fields.findIndex((item) => item.secret) ?? -1;
  const platformOauth = Boolean(
    selected && isOauthMail(selected.id) && data?.oauth?.[selected.id as "outlook" | "gmail"],
  );
  const showGuide = Boolean(selected && hasPluginCredentialGuide(selected.id));
  const visibleFields = (selected?.fields ?? []).filter((field) => {
    if (!isOauthMail(selected?.id ?? "") || !platformOauth) return true;
    return field.key !== "clientId" && field.key !== "clientSecret";
  });
  const isGithubCapabilityPending =
    pending.capability === "code.write" ||
    pending.capability === "code.read" ||
    pending.capability === "security.review";

  const startOauth = async () => {
    if (selected && isGithubPlugin(selected.id)) {
      const params = new URLSearchParams();
      if (runId) params.set("runId", runId);
      if (projectId) params.set("projectId", projectId);
      window.location.href = `/api/github/oauth/authorize?${params.toString()}`;
      return;
    }
    if (!selected || !isOauthMail(selected.id)) return;
    if (!platformOauth && (!fields.clientId || !fields.clientSecret)) {
      toast.error("Add your app client ID and secret, then connect.");
      return;
    }
    if (!platformOauth) {
      await new Promise<void>((resolve, reject) => {
        connect.mutate(
          { json: { catalogId: selected.id, fields, runId } },
          { onSuccess: () => resolve(), onError: (error) => reject(error) },
        );
      }).catch(() => undefined);
    }
    const params = new URLSearchParams({ catalogId: selected.id });
    if (runId) params.set("runId", runId);
    if (fields.from) params.set("from", fields.from);
    window.location.href = `/api/agent/plugins/oauth/start?${params.toString()}`;
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    if (isOauthMail(selected.id)) {
      void startOauth();
      return;
    }
    connect.mutate(
      {
        json: {
          catalogId: selected.id,
          fields,
          runId,
        },
      },
      {
        onSuccess: () => toast.success(`${selected.name} connected.`),
      },
    );
  };

  if (alreadyGranted) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-4">
        <p className="text-sm text-foreground">GitHub is already connected. Continuing…</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-4 space-y-3">
      <div className="flex items-start gap-2">
        <Plug className="size-4 text-primary mt-0.5 shrink-0" />
        <p className="text-sm text-foreground flex-1">{pending.summary}</p>
      </div>
      {pending.capability === "email.send" ? (
        <p className="text-xs text-muted-foreground">
          Adding someone to a project with their email is an organization invite. That uses Fairlx members — not Outlook or Gmail.
          Connect mail only if you want the Agent to send a message.
        </p>
      ) : null}
      {isGithubCapabilityPending ? (
        <p className="text-xs text-muted-foreground">
          Sign in with GitHub or paste a classic PAT with <span className="font-mono">repo</span> and{" "}
          <span className="font-mono">read:org</span>. Access applies to every Fairlx project. After connecting, the Agent will ask whether to create the repository under your personal account or an organization.
        </p>
      ) : null}
      <form className="space-y-3" onSubmit={onSubmit}>
        <div className="flex flex-wrap gap-2">
          {options.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setCatalogId(item.id);
                setFields({});
              }}
              className={cn(
                "h-8 px-3 rounded-full text-xs font-medium border",
                catalogId === item.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-border",
              )}
            >
              {item.name}
            </button>
          ))}
        </div>
        {showGuide ? (
          <p className="text-[11px] text-muted-foreground">
            Press the <span className="font-semibold italic">i</span> for a step-by-step connect guide.
            {isOauthMail(selected?.id ?? "")
              ? " You connect once; Fairlx keeps a refresh token so access tokens do not expire out from under the Agent."
              : null}
          </p>
        ) : null}
        {visibleFields.map((field) => {
          const originalIndex = selected?.fields.findIndex((item) => item.key === field.key) ?? -1;
          return (
            <div key={field.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">{field.label}</Label>
                {showGuide && originalIndex === firstSecretIndex ? (
                  <PluginCredentialGuide catalogId={selected!.id} />
                ) : null}
              </div>
              <Input
                type={field.secret ? "password" : "text"}
                className={cn("h-9", AGENT_FIELD_CLASS)}
                placeholder={field.placeholder}
                value={fields[field.key] ?? ""}
                onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            </div>
          );
        })}
        {isOauthMail(selected?.id ?? "") && showGuide && visibleFields.every((field) => !field.secret) ? (
          <div className="flex justify-end">
            <PluginCredentialGuide catalogId={selected!.id} />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {selected && isGithubPlugin(selected.id) ? (
            <Button
              type="button"
              size="sm"
              disabled={!githubOauthConfigured}
              onClick={() => void startOauth()}
            >
              Sign in with GitHub
            </Button>
          ) : null}
          <Button type="submit" size="sm" disabled={connect.isPending || !selected} variant={selected && isGithubPlugin(selected.id) ? "outline" : "primary"}>
            {connect.isPending
              ? "Connecting…"
              : isOauthMail(selected?.id ?? "")
                ? `Connect ${selected?.name ?? "mail"}`
                : isGithubPlugin(selected?.id ?? "")
                  ? "Connect with token"
                  : `Connect ${selected?.name ?? "plugin"}`}
          </Button>
          {runId && pending.capability === "email.send" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={continueRun.isPending}
              onClick={() => continueRun.mutate({ runId })}
            >
              {continueRun.isPending ? "Continuing…" : "Skip — this is an invite"}
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
