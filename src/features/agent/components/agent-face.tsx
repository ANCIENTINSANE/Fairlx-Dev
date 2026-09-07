"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { FairlxAgentFace } from "../face";
import { presentAgentFace } from "../face/present";
import { resolveAgentFaceMood, type AgentFaceMood } from "../lib/agent-face-mood";
import type { AgentRun } from "../types";

export { resolveAgentFaceMood, type AgentFaceMood };

const CELEBRATE_MS = 5500;

export function useAgentFaceMood(
  run?: Pick<AgentRun, "id" | "status" | "kind" | "events">,
  options?: { typing?: boolean; awaitingYou?: boolean; listening?: boolean },
): AgentFaceMood {
  const [celebrateUntil, setCelebrateUntil] = useState(0);
  const prev = useRef<{ id?: string; status?: AgentRun["status"] }>({
    id: run?.id,
    status: run?.status,
  });
  const [, tick] = useState(0);

  useEffect(() => {
    const prior = prev.current;
    if (run?.status === "completed" && (prior.id !== run.id || prior.status !== "completed")) {
      if (prior.status && prior.status !== "completed") {
        setCelebrateUntil(Date.now() + CELEBRATE_MS);
      }
    }
    prev.current = { id: run?.id, status: run?.status };
  }, [run?.id, run?.status]);

  useEffect(() => {
    if (!celebrateUntil) return;
    const wait = celebrateUntil - Date.now();
    if (wait <= 0) {
      setCelebrateUntil(0);
      return;
    }
    const timer = window.setTimeout(() => tick((n) => n + 1), wait);
    return () => window.clearTimeout(timer);
  }, [celebrateUntil]);

  return resolveAgentFaceMood({
    status: run?.status,
    kind: run?.kind,
    events: run?.events,
    typing: options?.typing,
    awaitingYou: options?.awaitingYou,
    listening: options?.listening,
    celebrating: Date.now() < celebrateUntil,
  });
}

export function AgentFace({
  mood = "idle",
  size = 48,
  className,
  tracking,
  floating,
  gazeProgress = 0.5,
}: {
  mood?: AgentFaceMood;
  size?: number;
  className?: string;
  tracking?: boolean;
  floating?: boolean;
  gazeProgress?: number;
}) {
  const { emotion, gaze } = presentAgentFace(mood);
  const compact = size < 160;
  return (
    <FairlxAgentFace
      emotion={emotion}
      gaze={gaze}
      gazeProgress={gazeProgress}
      size={size}
      tracking={tracking ?? !compact}
      floating={floating ?? !compact}
      className={cn("shrink-0", className)}
    />
  );
}
