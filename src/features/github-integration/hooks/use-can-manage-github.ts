"use client";

import { useCurrentMember } from "@/features/members/hooks/use-current-member";
import { useProjectPermissions } from "@/hooks/use-project-permissions";

export function useCanManageGithubIntegration(params: {
  projectId?: string | null;
  workspaceId?: string | null;
}) {
  const { isAdmin: workspaceAdmin, isLoading: workspaceLoading } = useCurrentMember({
    workspaceId: params.workspaceId || "",
  });
  const {
    isProjectAdmin,
    canEditProjectSettings,
    canManageProjectSettings,
    isLoading: projectLoading,
  } = useProjectPermissions({
    projectId: params.projectId,
    workspaceId: params.workspaceId,
  });

  return {
    canManage:
      Boolean(workspaceAdmin) ||
      Boolean(isProjectAdmin) ||
      Boolean(canEditProjectSettings) ||
      Boolean(canManageProjectSettings),
    isLoading: workspaceLoading || projectLoading,
  };
}
