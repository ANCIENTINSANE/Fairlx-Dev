"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { subscribeFairlxQuerySync } from "@/lib/fairlx-query-sync";

/** Listens for other-tab cache invalidations and applies them to this QueryClient. */
export function useFairlxQuerySync() {
  const queryClient = useQueryClient();

  useEffect(() => subscribeFairlxQuerySync(queryClient), [queryClient]);
}

export function FairlxQuerySyncBridge() {
  useFairlxQuerySync();
  return null;
}
