import type { Databases } from "node-appwrite";

import { DATABASE_ID, PROJECTS_ID } from "@/config";
import { MemberRole } from "@/features/members/types";
import { getMember } from "@/features/members/utils";
import { ProjectPermissionKey } from "@/lib/permissions/types";
import { resolveUserProjectAccess } from "@/lib/permissions/resolveUserProjectAccess";

export const GITHUB_ATTACH_FORBIDDEN =
  "Only workspace admins, project admins, or people who can edit project settings can attach a GitHub repository to this Fairlx project. Your GitHub account can still create a repository; ask a lead to attach it here.";

export function canManageProjectGithubIntegration(input: {
  workspaceRole?: string | null;
  isProjectAdmin?: boolean;
  isProjectOwner?: boolean;
  permissions?: string[];
}): boolean {
  const role = (input.workspaceRole || "").toUpperCase();
  if (role === MemberRole.ADMIN || role === MemberRole.OWNER) return true;
  if (input.isProjectOwner || input.isProjectAdmin) return true;
  const permissions = input.permissions ?? [];
  return (
    permissions.includes(ProjectPermissionKey.EDIT_SETTINGS) ||
    permissions.includes(ProjectPermissionKey.MANAGE_SETTINGS)
  );
}

export async function userCanManageProjectGithub(
  databases: Databases,
  userId: string,
  projectId: string,
): Promise<boolean> {
  const project = await databases.getDocument(DATABASE_ID, PROJECTS_ID, projectId);
  const member = await getMember({
    databases,
    workspaceId: String(project.workspaceId),
    userId,
  });
  if (!member) return false;
  const access = await resolveUserProjectAccess(databases, userId, projectId);
  return canManageProjectGithubIntegration({
    workspaceRole: member.role,
    isProjectAdmin: access.isAdmin,
    isProjectOwner: access.isOwner,
    permissions: access.permissions,
  });
}
