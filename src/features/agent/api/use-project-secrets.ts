import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { client } from "@/lib/rpc";

const SECRET_KEY = ["agent-project-secrets"] as const;

export function useListProjectSecrets(projectId?: string) {
  return useQuery({
    queryKey: [...SECRET_KEY, projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const response = await client.api.agent.secrets.$get({ query: { projectId: projectId! } });
      if (!response.ok) throw new Error("Failed to load secrets.");
      const { data } = await response.json();
      return data as Array<{ id: string; name: string; projectId: string }>;
    },
  });
}

export function useUpsertProjectSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (json: { projectId: string; workspaceId: string; name: string; value: string }) => {
      const response = await client.api.agent.secrets.$post({ json });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Failed to save secret." }));
        throw new Error("error" in body && typeof body.error === "string" ? body.error : "Failed to save secret.");
      }
      return (await response.json()).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SECRET_KEY });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to save secret."),
  });
}

export function useDeleteProjectSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { secretId: string; projectId: string }) => {
      const response = await client.api.agent.secrets[":secretId"].$delete({
        param: { secretId: input.secretId },
      });
      if (!response.ok) throw new Error("Failed to delete secret.");
      return (await response.json()).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SECRET_KEY });
    },
  });
}
