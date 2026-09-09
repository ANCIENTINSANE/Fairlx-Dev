"use client";

import { useEffect, useRef } from "react";

import { parsePageUiAction } from "../lib/page-ui-action";
import type { AgentRun } from "../types";
import { useAgentPageActions } from "../components/agent-page-context";

/** Apply page_ui tool events from the active run onto the open Fairlx screen. */
export function useAgentPageUiSync(run?: AgentRun | null) {
  const ctx = useAgentPageActions();
  const appliedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!run || !ctx) return;
    for (const event of run.events) {
      if (event.type !== "page_ui") continue;
      const key = `${run.id}:${event.id}`;
      if (appliedRef.current.has(key)) continue;
      appliedRef.current.add(key);
      const parsed = parsePageUiAction(event.payload);
      if (!parsed.ok) continue;
      ctx.applyAction(parsed.value);
    }
  }, [run, ctx]);
}
