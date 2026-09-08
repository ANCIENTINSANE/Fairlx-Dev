"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGetCodingEnvironment, useUpsertCodingEnvironment } from "../api/use-coding-environment";
import { useDeleteProjectSecret, useListProjectSecrets, useUpsertProjectSecret } from "../api/use-project-secrets";

export function CodingEnvironmentCard({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  const { data } = useGetCodingEnvironment(projectId);
  const save = useUpsertCodingEnvironment();
  const secrets = useListProjectSecrets(projectId);
  const upsertSecret = useUpsertProjectSecret();
  const removeSecret = useDeleteProjectSecret();
  const env = data?.environment;
  const [runtime, setRuntime] = useState(env?.runtime || "node");
  const [prepareScript, setPrepareScript] = useState(env?.prepareScript || "");
  const [startCommand, setStartCommand] = useState(env?.startCommand || "");
  const [exposePort, setExposePort] = useState(String(env?.exposePort || 3000));
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");

  useEffect(() => {
    if (!env) return;
    setRuntime(env.runtime || "node");
    setPrepareScript(env.prepareScript || "");
    setStartCommand(env.startCommand || "");
    setExposePort(String(env.exposePort || 3000));
  }, [env]);

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <p className="text-sm font-medium">Coding environment</p>
        <p className="text-xs text-muted-foreground">
          Used when Fairlx starts the Azure sandbox. Install and start run in the sandbox, never on the Fairlx host.
        </p>
      </div>
      <label className="block space-y-1 text-xs">
        Runtime
        <Input value={runtime} onChange={(event) => setRuntime(event.target.value)} placeholder="node | python | go" />
      </label>
      <label className="block space-y-1 text-xs">
        Prepare script
        <Input value={prepareScript} onChange={(event) => setPrepareScript(event.target.value)} placeholder="pnpm install" />
      </label>
      <label className="block space-y-1 text-xs">
        Start command
        <Input value={startCommand} onChange={(event) => setStartCommand(event.target.value)} placeholder="pnpm dev" />
      </label>
      <label className="block space-y-1 text-xs">
        Preview port
        <Input value={exposePort} onChange={(event) => setExposePort(event.target.value)} placeholder="3000" />
      </label>
      <Button
        type="button"
        size="sm"
        disabled={save.isPending}
        onClick={() =>
          save.mutate({
            projectId,
            workspaceId,
            runtime,
            prepareScript,
            startCommand,
            exposePort: Number(exposePort) || 3000,
            envNames: (secrets.data ?? []).map((item) => item.name),
          })
        }
      >
        Save environment
      </Button>

      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-sm font-medium">Fairlx secrets</p>
        <p className="text-xs text-muted-foreground">
          GitHub Actions-style names (NPM_TOKEN). Values are encrypted at rest and injected into the sandbox. They are never shown again.
        </p>
        {(secrets.data ?? []).map((item) => (
          <div key={item.id} className="flex items-center justify-between text-xs">
            <span className="font-mono">{item.name}</span>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => removeSecret.mutate({ secretId: item.id, projectId })}
            >
              Delete
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Input value={secretName} onChange={(event) => setSecretName(event.target.value.toUpperCase())} placeholder="SECRET_NAME" />
          <Input
            type="password"
            value={secretValue}
            onChange={(event) => setSecretValue(event.target.value)}
            placeholder="value"
          />
          <Button
            type="button"
            size="sm"
            disabled={upsertSecret.isPending || !secretName || !secretValue}
            onClick={() => {
              upsertSecret.mutate(
                { projectId, workspaceId, name: secretName, value: secretValue },
                {
                  onSuccess: () => {
                    setSecretName("");
                    setSecretValue("");
                    toast.success("Secret saved");
                  },
                },
              );
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
