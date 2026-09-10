import { Databases, Query, type Models } from "node-appwrite";
import {
  DATABASE_ID,
  WORKFLOW_STATUSES_ID,
  WORKFLOW_TRANSITIONS_ID,
  PROJECT_TEAM_MEMBERS_ID,
} from "@/config";

function foldStatusLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+column$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findWorkflowStatus(docs: Models.Document[], value: string): Models.Document | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  const folded = foldStatusLabel(raw);
  return docs.find((status) => {
    const key = String(status.key ?? "");
    const name = String(status.name ?? "");
    return (
      key === raw ||
      key.toLowerCase() === raw.toLowerCase() ||
      foldStatusLabel(key) === folded ||
      foldStatusLabel(name) === folded
    );
  });
}

/**
 * Validate if a status transition is allowed for the user.
 *
 * Implements fail-closed security: on validation error, the transition is BLOCKED
 * to prevent bypassing workflow rules due to network/API failures.
 *
 * Edge Cases Handled:
 * - 1.1 Transition Not Defined: Returns error with human-readable status names
 * - 1.2 Same Status Transition: Always allowed (no validation needed)
 * - 1.3 Legacy/Backward Compatibility: Allowed if statuses not in workflow
 * - 1.4 Circular Transitions (Loops): Allowed if transition is defined
 * - 1.5 Network/API Error: BLOCKED (fail-closed for security)
 */
export async function validateStatusTransition(
  databases: Databases,
  workflowId: string,
  fromStatus: string,
  toStatus: string,
  userId: string,
  projectId: string,
  memberRole: string
): Promise<{ allowed: boolean; reason?: string; message?: string }> {
  // Edge Case 1.2: Same status transition - always allowed
  if (fromStatus === toStatus) {
    return { allowed: true };
  }

  try {
    const workflowStatuses = await databases.listDocuments(
      DATABASE_ID,
      WORKFLOW_STATUSES_ID,
      [Query.equal("workflowId", workflowId)]
    );

    const fromStatusDoc = findWorkflowStatus(workflowStatuses.documents, fromStatus);
    const toStatusDoc = findWorkflowStatus(workflowStatuses.documents, toStatus);

    if (fromStatusDoc && toStatusDoc && fromStatusDoc.$id === toStatusDoc.$id) {
      return { allowed: true };
    }

    // Edge Case 1.3: Legacy/Backward Compatibility
    if (!fromStatusDoc || !toStatusDoc) {
      return { allowed: true };
    }

    const transitions = await databases.listDocuments(
      DATABASE_ID,
      WORKFLOW_TRANSITIONS_ID,
      [
        Query.equal("workflowId", workflowId),
        Query.equal("fromStatusId", fromStatusDoc.$id),
        Query.equal("toStatusId", toStatusDoc.$id),
      ]
    );

    if (transitions.total === 0) {
      return {
        allowed: false,
        reason: "TRANSITION_NOT_DEFINED",
        message: `Cannot move from "${fromStatusDoc.name}" to "${toStatusDoc.name}". This transition is not allowed in the workflow.`,
      };
    }

    const transition = transitions.documents[0];

    if (transition.allowedMemberRoles && transition.allowedMemberRoles.length > 0) {
      if (!transition.allowedMemberRoles.includes(memberRole)) {
        return {
          allowed: false,
          reason: "ROLE_NOT_ALLOWED",
          message: `Your role (${memberRole}) cannot perform this transition. Allowed roles: ${transition.allowedMemberRoles.join(", ")}`,
        };
      }
    }

    if (transition.allowedTeamIds && transition.allowedTeamIds.length > 0) {
      const userTeams = await databases.listDocuments(
        DATABASE_ID,
        PROJECT_TEAM_MEMBERS_ID,
        [Query.equal("userId", userId), Query.equal("projectId", projectId)]
      );

      const userTeamIds = userTeams.documents.map((t) => t.teamId as string);
      const hasAllowedTeam = transition.allowedTeamIds.some((teamId: string) =>
        userTeamIds.includes(teamId)
      );

      if (!hasAllowedTeam) {
        return {
          allowed: false,
          reason: "TEAM_NOT_ALLOWED",
          message: "Your team does not have permission to perform this transition",
        };
      }
    }

    if (transition.requiresApproval) {
      const userTeams = await databases.listDocuments(
        DATABASE_ID,
        PROJECT_TEAM_MEMBERS_ID,
        [Query.equal("userId", userId), Query.equal("projectId", projectId)]
      );

      const userTeamIds = userTeams.documents.map((t) => t.teamId as string);
      const isApprover = transition.approverTeamIds?.some((teamId: string) =>
        userTeamIds.includes(teamId)
      );

      if (!isApprover) {
        return {
          allowed: false,
          reason: "REQUIRES_APPROVAL",
          message: "This transition requires approval from designated approvers",
        };
      }
    }

    return { allowed: true };
  } catch (error) {
    console.error("Workflow transition validation error:", error);
    return {
      allowed: false,
      reason: "VALIDATION_ERROR",
      message: "Failed to validate workflow transition. Please try again.",
    };
  }
}
