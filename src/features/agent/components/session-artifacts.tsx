"use client";

import type { CodingSession } from "../types";

export function SessionArtifacts({
  session,
}: {
  session?: CodingSession | null;
}) {
  const artifacts = session?.artifacts ?? session?.meta?.artifacts ?? [];
  if (!artifacts.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sandbox captures</p>
      {artifacts.map((artifact) => (
        <div key={artifact.id} className="rounded-lg border border-sidebar-border bg-card p-2">
          <p className="text-[11px] text-foreground">
            {artifact.kind === "recording" ? "Recording" : "Screenshot"} · {new Date(artifact.createdAt).toLocaleTimeString()}
          </p>
          {artifact.note ? <p className="text-[11px] text-muted-foreground">{artifact.note}</p> : null}
          {session ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={artifact.kind}
              src={`/api/agent/coding-sessions/${session.id}/artifacts/${artifact.id}`}
              className="mt-1 w-full rounded border border-sidebar-border bg-background"
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
