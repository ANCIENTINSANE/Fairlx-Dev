"use client";

import { Camera, Video } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CodingSession } from "../types";
import { AccentCard, SidebarSection } from "./workflow-sidebar-ui";

export function SessionArtifacts({
  session,
  embedded,
}: {
  session?: CodingSession | null;
  embedded?: boolean;
}) {
  const artifacts = session?.artifacts ?? session?.meta?.artifacts ?? [];
  if (!artifacts.length) return null;
  const list = (
      <div className="space-y-2">
        {artifacts.map((artifact) => {
          const recording = artifact.kind === "recording";
          return (
            <AccentCard key={artifact.id} tone={recording ? "violet" : "indigo"}>
              <div className="p-2">
                <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                  {recording ? <Video className="size-3 text-violet-600 dark:text-violet-300" /> : <Camera className="size-3 text-indigo-600 dark:text-indigo-300" />}
                  {recording ? "Recording" : "Screenshot"}
                  <span className="text-muted-foreground">· {new Date(artifact.createdAt).toLocaleTimeString()}</span>
                </p>
                {artifact.note ? <p className="mt-0.5 text-[11px] text-muted-foreground">{artifact.note}</p> : null}
                {session ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={artifact.kind}
                    src={`/api/agent/coding-sessions/${session.id}/artifacts/${artifact.id}`}
                    className={cn("mt-1.5 w-full rounded-md border border-border bg-background")}
                  />
                ) : null}
              </div>
            </AccentCard>
          );
        })}
      </div>
  );
  if (embedded) return list;
  return (
    <SidebarSection icon={Camera} tone="indigo" title="Sandbox captures">
      {list}
    </SidebarSection>
  );
}
