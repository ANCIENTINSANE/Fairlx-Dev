"use client";

import { Suspense } from "react";
import { PageError } from "@/components/page-error";
import { PageLoader } from "@/components/page-loader";

import { useGetWorkspace } from "@/features/workspaces/api/use-get-workspace";
import { EditWorkspaceForm } from "@/features/workspaces/components/edit-workspace-form";
import { useWorkspaceId } from "@/features/workspaces/hooks/use-workspace-id";
import { useCurrentMember } from "@/features/members/hooks/use-current-member";
import { useRegisterAgentPage } from "@/features/agent/components/agent-page-context";
import { chromePageLayout } from "@/features/agent/lib/page-context";

const WorkspaceIdSettingsClientContent = () => {
  const workspaceId = useWorkspaceId();
  const { data: initialValues, isLoading } = useGetWorkspace({ workspaceId });
  const {
    isLoading: isMemberLoading,
    isAdmin,
  } = useCurrentMember({ workspaceId });

  useRegisterAgentPage(() => ({
    page: "Workspace settings",
    heading: initialValues?.name ? `${initialValues.name} settings` : "Workspace settings",
    layout: chromePageLayout("Workspace settings", [
      { id: "form", position: "main", label: "Edit workspace" },
    ]),
    entities: initialValues
      ? [{ kind: "workspace", id: initialValues.$id, title: initialValues.name, location: "settings" }]
      : [],
    actions: ["navigate"],
  }));

  if (isLoading || isMemberLoading) {
    return <PageLoader />;
  }

  if (!initialValues) {
    return <PageError message="Workspace not found." />;
  }

  if (!isAdmin) {
    return <PageError message="You need admin access to manage this workspace." />;
  }

  return <EditWorkspaceForm initialValues={initialValues} />;
};

export const WorkspaceIdSettingsClient = () => {
  return (
    <Suspense fallback={<PageLoader />}>
      <WorkspaceIdSettingsClientContent />
    </Suspense>
  );
};