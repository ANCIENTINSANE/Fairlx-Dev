import { useQuery } from "@tanstack/react-query";

import { client } from "@/lib/rpc";

interface UseGetWorkItemProps {
  workItemId: string;
}

export const useGetWorkItem = ({ workItemId }: UseGetWorkItemProps) => {
  const query = useQuery({
    queryKey: ["work-item", workItemId],
    enabled: Boolean(workItemId),
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!workItemId) {
        throw new Error("workItemId is required to fetch work item.");
      }

      const response = await client.api["work-items"][":workItemId"].$get({
        param: { workItemId },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch work item.");
      }

      const { data } = await response.json();

      return data;
    },
  });

  return query;
};
