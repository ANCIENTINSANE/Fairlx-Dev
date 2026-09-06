"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { applyFairlxSyncKinds } from "@/lib/fairlx-query-sync";

import { agentMutationSnapshot } from "../lib/mutation-sync";
import type { AgentRun } from "../types";

const THROTTLE_MS = 300;

/** When the agent writes Fairlx data, refresh the rest of the app (and other tabs). */
export function useAgentMutationSync(run?: AgentRun | null) {
  const queryClient = useQueryClient();
  const appliedRef = useRef("");
  const latestRef = useRef(agentMutationSnapshot(run));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  latestRef.current = agentMutationSnapshot(run);

  useEffect(() => {
    const snapshot = latestRef.current;
    if (!snapshot.fingerprint || snapshot.fingerprint === appliedRef.current) return;
    if (timerRef.current) return;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const current = latestRef.current;
      if (!current.fingerprint || current.fingerprint === appliedRef.current) return;
      appliedRef.current = current.fingerprint;
      if (current.kinds.length > 0) applyFairlxSyncKinds(queryClient, current.kinds);
    }, THROTTLE_MS);
  }, [run, queryClient]);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const current = latestRef.current;
      if (!current.fingerprint || current.fingerprint === appliedRef.current) return;
      appliedRef.current = current.fingerprint;
      if (current.kinds.length > 0) applyFairlxSyncKinds(queryClient, current.kinds);
    },
    [queryClient],
  );
}
