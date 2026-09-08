import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { client } from "@/lib/rpc";

const ENV_KEY = ["agent-coding-environment"] as const;

export function useGetCodingEnvironment(projectId?: string) {
  return useQuery({
    queryKey: [...ENV_KEY, projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const response = await client.api.agent["coding-environment"].$get({ query: { projectId: projectId! } });
      if (!response.ok) throw new Error("Failed to load coding environment.");
      return (await response.json()).data as {
        environment: {
          id?: string;
          runtime?: string;
          prepareScript?: string;
          startCommand?: string;
          exposePort?: number;
          envNames: string[];
        } | null;
      };
    },
  });
}

export function useUpsertCodingEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (json: {
      projectId: string;
      workspaceId: string;
      runtime?: string;
      prepareScript?: string;
      startCommand?: string;
      exposePort?: number;
      envNames?: string[];
    }) => {
      const response = await client.api.agent["coding-environment"].$post({ json });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Failed to save." }));
        throw new Error("error" in body && typeof body.error === "string" ? body.error : "Failed to save.");
      }
      return (await response.json()).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ENV_KEY });
      toast.success("Coding environment saved.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to save environment."),
  });
}
