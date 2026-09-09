import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { client } from "@/lib/rpc";
import { QUERY_CONFIG } from "@/lib/query-config";
import { AGENT_CODING_SESSIONS_QUERY_KEY } from "../constants";
import type { CodingSessionStatus } from "../types";
import { agentRunQueryKey } from "./use-agent-runs";

const IDLE_CODING_SESSION: CodingSessionStatus[] = ["merged", "failed", "stopped"];

export function codingSessionPollMs(status?: CodingSessionStatus, runLive = false): number | false {
  if (status && !IDLE_CODING_SESSION.includes(status)) return 2500;
  if (runLive) return 2500;
  return false;
}

export function useGetCodingSession(params: {
  runId?: string;
  workItemId?: string;
  projectId?: string;
  runLive?: boolean;
}) {
  const enabled = Boolean(params.runId || params.workItemId || params.projectId);
  return useQuery({
    queryKey: [...AGENT_CODING_SESSIONS_QUERY_KEY, params.runId, params.workItemId, params.projectId],
    enabled,
    staleTime: QUERY_CONFIG.REALTIME.staleTime,
    refetchInterval: (query) => codingSessionPollMs(query.state.data?.session?.status, params.runLive),
    queryFn: async () => {
      const response = await client.api.agent["coding-sessions"].$get({
        query: {
          runId: params.runId,
          workItemId: params.workItemId,
          projectId: params.projectId,
        },
      });
      if (!response.ok) throw new Error("Failed to load coding session.");
      const { data } = await response.json();
      return data;
    },
  });
}

export function useStartCodingSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (json: { workItemId: string; projectId?: string; runId?: string; exposePort?: number }) => {
      const response = await client.api.agent["coding-sessions"].$post({ json });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Failed to start coding session." }));
        throw new Error("error" in body && typeof body.error === "string" ? body.error : "Failed to start coding session.");
      }
      return (await response.json()).data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: AGENT_CODING_SESSIONS_QUERY_KEY });
      if (data?.runId) void queryClient.invalidateQueries({ queryKey: agentRunQueryKey(data.runId) });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to start coding session."),
  });
}

export function useCommentCodingSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; path: string; line: number; body: string }) => {
      const response = await client.api.agent["coding-sessions"][":sessionId"].comment.$post({
        param: { sessionId: input.sessionId },
        json: { path: input.path, line: input.line, body: input.body },
      });
      if (!response.ok) throw new Error("Failed to send comment.");
      return (await response.json()).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AGENT_CODING_SESSIONS_QUERY_KEY });
    },
  });
}

export function useMergeCodingSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await client.api.agent["coding-sessions"][":sessionId"].merge.$post({
        param: { sessionId },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Merge failed." }));
        throw new Error("error" in body && typeof body.error === "string" ? body.error : "Merge failed.");
      }
      return (await response.json()).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AGENT_CODING_SESSIONS_QUERY_KEY });
      toast.success("Merge requested. Accept in the agent if you are in staged mode.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Merge failed."),
  });
}
