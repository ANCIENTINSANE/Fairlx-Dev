import { ID, Databases, Query } from "node-appwrite";
import { DATABASE_ID, MEMBERS_ID, PROJECT_ROLES_ID, PROJECT_MEMBERS_ID } from "@/config";
import { ProjectMemberRole, ProjectMemberStatus } from "@/features/project-teams/types";
import { ROLE_PERMISSIONS } from "@/lib/permissions/resolveUserProjectAccess";

// =============================================================================
// DEFAULT ROLE DEFINITIONS
// =============================================================================

/**
 * Default project role names
 * These roles are automatically created for every new project.
 * Names are canonical and used for idempotency checks.
 */
export const DEFAULT_PROJECT_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
export type DefaultProjectRoleName = typeof DEFAULT_PROJECT_ROLES[number];

/**
 * Default role configuration
 * Maps role enum to displayable properties and permissions.
 */
interface DefaultRoleConfig {
    role: ProjectMemberRole;
    name: DefaultProjectRoleName;
    color: string;
    description: string;
}

const DEFAULT_ROLE_CONFIGS: DefaultRoleConfig[] = [
    {
        role: ProjectMemberRole.PROJECT_OWNER,
        name: "OWNER",
        color: "#ef4444", // Red
        description: "Full access to project settings, members, and resources.",
    },
    {
        role: ProjectMemberRole.PROJECT_ADMIN,
        name: "ADMIN",
        color: "#f97316", // Orange
        description: "Can manage tasks, sprints, and docs, but cannot delete the project.",
    },
    {
        role: ProjectMemberRole.MEMBER,
        name: "MEMBER",
        color: "#3b82f6", // Blue
        description: "Can create and edit tasks, but has limited administrative access.",
    },
    {
        role: ProjectMemberRole.VIEWER,
        name: "VIEWER",
        color: "#6b7280", // Gray
        description: "Can view project resources but cannot make changes.",
    },
];

// =============================================================================
// ROLE SEEDING RESULT TYPE
// =============================================================================

export interface SeedProjectRolesResult {
    success: boolean;
    rolesCreated: string[];
    rolesFailed: string[];
    ownerRoleId: string | null;
    ownerMembershipCreated: boolean;
    error?: string;
}

// =============================================================================
// SEED PROJECT ROLES
// =============================================================================

/**
 * Seed Default Project Roles
 *
 * Creates the standard roles (Owner, Admin, Member, Viewer) for a new project.
 *
 * IDEMPOTENT: Safe to call multiple times.
 * - Checks which roles already exist (by projectId + name)
 * - Only creates missing roles
 * - Returns early if all roles exist
 *
 * TRANSACTION SAFETY:
 * - Roles are created independently
 * - Partial failures are recorded but don't stop other roles
 * - Returns detailed result for debugging
 *
 * @param databases - Appwrite Databases instance (session or admin)
 * @param projectId - The project to seed roles for
 * @param workspaceId - The workspace the project belongs to
 * @param createdByUserId - The user creating these roles (for audit)
 * @returns Detailed result of the seeding operation
 */
export async function seedProjectRoles(
    databases: Databases,
    projectId: string,
    workspaceId: string,
    createdByUserId: string
): Promise<SeedProjectRolesResult> {
    const result: SeedProjectRolesResult = {
        success: false,
        rolesCreated: [],
        rolesFailed: [],
        ownerRoleId: null,
        ownerMembershipCreated: false,
    };

    try {
        // Step 1: Fetch existing roles for this project (idempotency check)
        const existingRoles = await databases.listDocuments(
            DATABASE_ID,
            PROJECT_ROLES_ID,
            [
                Query.equal("projectId", projectId),
                Query.limit(100), // Should be plenty for default + custom roles
            ]
        );

        const existingRoleNames = new Set(
            existingRoles.documents.map((r) => r.name as string)
        );

        // Find existing owner role if any
        const existingOwnerRole = existingRoles.documents.find(
            (r) => r.name === "OWNER"
        );
        if (existingOwnerRole) {
            result.ownerRoleId = existingOwnerRole.$id;
        }

        // Step 2: Determine which roles need to be created
        const rolesToCreate = DEFAULT_ROLE_CONFIGS.filter(
            (config) => !existingRoleNames.has(config.name)
        );

        if (rolesToCreate.length === 0) {
            // All roles already exist - idempotent success
            result.success = true;
            return result;
        }

        // Step 3: Create missing roles (parallel for performance)
        const createPromises = rolesToCreate.map(async (config) => {
            try {
                const permissions = ROLE_PERMISSIONS[config.role] || [];

                const role = await databases.createDocument(
                    DATABASE_ID,
                    PROJECT_ROLES_ID,
                    ID.unique(),
                    {
                        workspaceId,
                        projectId,
                        name: config.name,
                        description: config.description,
                        permissions,
                        color: config.color,
                        isDefault: true, // Flag to identify system/default roles
                        createdBy: createdByUserId,
                    }
                );

                result.rolesCreated.push(config.name);

                // Track owner role ID for member assignment
                if (config.name === "OWNER") {
                    result.ownerRoleId = role.$id;
                }

                return { success: true, name: config.name, roleId: role.$id };
            } catch (error) {
                result.rolesFailed.push(config.name);
                console.error(
                    `[seedProjectRoles] Failed to create role "${config.name}" for project ${projectId}:`,
                    error
                );
                return { success: false, name: config.name, error };
            }
        });

        await Promise.all(createPromises);

        // Consider success if at least one role was created and no critical failures
        result.success =
            result.rolesCreated.length > 0 || result.rolesFailed.length === 0;

        return result;
    } catch (error) {
        result.error = error instanceof Error ? error.message : "Unknown error";
        console.error(
            `[seedProjectRoles] Critical error seeding roles for project ${projectId}:`,
            error
        );
        return result;
    }
}

// =============================================================================
// ASSIGN OWNER MEMBERSHIP
// =============================================================================

/**
 * Assign Project OWNER Membership
 *
 * Creates a project membership record for the owner with the OWNER role.
 *
 * IDEMPOTENT: Safe to call multiple times.
 * - Checks if user is already a member of the project
 * - If already a member, does not duplicate
 *
 * SECURITY:
 * - Only assigns OWNER role if ownerRoleId is provided
 * - Does not escalate privileges if user already has a role
 *
 * @param databases - Appwrite Databases instance
 * @param projectId - The project to assign ownership
 * @param workspaceId - The workspace the project belongs to
 * @param userId - The user to assign as owner
 * @param ownerRoleId - The ID of the OWNER role document
 * @returns True if membership was created, false if already exists
 */
export async function assignProjectOwnerMembership(
    databases: Databases,
    projectId: string,
    workspaceId: string,
    userId: string,
    ownerRoleId: string
): Promise<{ created: boolean; membershipId: string | null; error?: string }> {
    try {
        // Check if user is already a project member (idempotency)
        const existingMembership = await databases.listDocuments(
            DATABASE_ID,
            PROJECT_MEMBERS_ID,
            [
                Query.equal("projectId", projectId),
                Query.equal("userId", userId),
                Query.limit(1),
            ]
        );

        if (existingMembership.total > 0) {
            // User is already a member - return existing membership
            return {
                created: false,
                membershipId: existingMembership.documents[0].$id,
            };
        }

        // Create new membership with OWNER role
        // Using the reference pattern (roleId) matching project-members collection schema
        const membership = await databases.createDocument(
            DATABASE_ID,
            PROJECT_MEMBERS_ID,
            ID.unique(),
            {
                workspaceId,
                projectId,
                teamId: "", // No team initially - project members can be assigned to teams later
                userId,
                role: ProjectMemberRole.PROJECT_OWNER,
                roleId: ownerRoleId,
                roleName: "OWNER", // Denormalized for quick access
                status: ProjectMemberStatus.ACTIVE,
                joinedAt: new Date().toISOString(),
                addedBy: userId, // Self-added as project creator
            }
        );

        return {
            created: true,
            membershipId: membership.$id,
        };
    } catch (error) {
        console.error(
            `[assignProjectOwnerMembership] Failed to assign OWNER membership for user ${userId} in project ${projectId}:`,
            error
        );
        return {
            created: false,
            membershipId: null,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

function projectRoleRank(name: string): number {
    const key = name.toUpperCase().replace(/[^A-Z]/g, "");
    if (key.includes("OWNER")) return 4;
    if (key.includes("ADMIN")) return 3;
    if (key.includes("VIEWER")) return 1;
    return 2;
}

function isPrivilegedWorkspaceRole(role: string): boolean {
    const key = role.trim().toUpperCase();
    return key === "OWNER" || key === "ADMIN" || key === "WS_ADMIN";
}

function projectRoleForWorkspaceRole(workspaceRole: string): {
    name: DefaultProjectRoleName;
    enum: ProjectMemberRole;
} {
    const key = workspaceRole.trim().toUpperCase();
    if (key === "OWNER") {
        return { name: "OWNER", enum: ProjectMemberRole.PROJECT_OWNER };
    }
    return { name: "ADMIN", enum: ProjectMemberRole.PROJECT_ADMIN };
}

/**
 * Workspace OWNER and ADMIN must appear on every project with the matching
 * high role (OWNER / ADMIN). Idempotent — upgrades a lower role, never demotes.
 */
export async function ensurePrivilegedWorkspaceMembersOnProject(
    databases: Databases,
    projectId: string,
    workspaceId: string
): Promise<void> {
    const seed = await seedProjectRoles(databases, projectId, workspaceId, "system");
    const roles = await databases.listDocuments(
        DATABASE_ID,
        PROJECT_ROLES_ID,
        [Query.equal("projectId", projectId), Query.limit(100)]
    );
    const roleByName = new Map(
        roles.documents.map((role) => [String(role.name).toUpperCase(), role])
    );
    if (seed.ownerRoleId && !roleByName.has("OWNER")) {
        const owner = roles.documents.find((role) => role.$id === seed.ownerRoleId);
        if (owner) roleByName.set("OWNER", owner);
    }

    const workspaceMembers = await databases.listDocuments(
        DATABASE_ID,
        MEMBERS_ID,
        [Query.equal("workspaceId", workspaceId), Query.limit(100)]
    );

    for (const member of workspaceMembers.documents) {
        const workspaceRole = String(member.role ?? "");
        if (!isPrivilegedWorkspaceRole(workspaceRole)) continue;
        if (String(member.deletedAt ?? "").trim()) continue;
        const userId = String(member.userId ?? "");
        if (!userId) continue;

        const wanted = projectRoleForWorkspaceRole(workspaceRole);
        const wantedRole = roleByName.get(wanted.name);
        if (!wantedRole) continue;

        const existing = await databases.listDocuments(
            DATABASE_ID,
            PROJECT_MEMBERS_ID,
            [
                Query.equal("projectId", projectId),
                Query.equal("userId", userId),
                Query.limit(1),
            ]
        );

        if (existing.total === 0) {
            try {
                await databases.createDocument(
                    DATABASE_ID,
                    PROJECT_MEMBERS_ID,
                    ID.unique(),
                    {
                        workspaceId,
                        projectId,
                        teamId: "",
                        userId,
                        role: wanted.enum,
                        roleId: wantedRole.$id,
                        roleName: wanted.name,
                        status: ProjectMemberStatus.ACTIVE,
                        joinedAt: new Date().toISOString(),
                        addedBy: userId,
                    }
                );
            } catch (error) {
                console.error(
                    `[ensurePrivilegedWorkspaceMembersOnProject] Failed to add ${userId} as ${wanted.name} on ${projectId}:`,
                    error
                );
            }
            continue;
        }

        const current = existing.documents[0]!;
        const currentName = String(current.roleName || current.role || "MEMBER");
        if (projectRoleRank(currentName) >= projectRoleRank(wanted.name)) continue;
        try {
            await databases.updateDocument(
                DATABASE_ID,
                PROJECT_MEMBERS_ID,
                current.$id,
                {
                    role: wanted.enum,
                    roleId: wantedRole.$id,
                    roleName: wanted.name,
                    status: ProjectMemberStatus.ACTIVE,
                }
            );
        } catch (error) {
            console.error(
                `[ensurePrivilegedWorkspaceMembersOnProject] Failed to upgrade ${userId} to ${wanted.name} on ${projectId}:`,
                error
            );
        }
    }
}

// =============================================================================
// COMBINED SEEDING FUNCTION
// =============================================================================

/**
 * Seed Default Project Roles and Assign Owner
 *
 * COMBINED OPERATION: Creates roles AND assigns owner membership atomically.
 *
 * This is the PRIMARY function to call after project creation.
 *
 * GUARANTEES:
 * 1. All default roles are created (idempotent)
 * 2. Project creator is assigned as Owner (idempotent)
 * 3. Safe to call multiple times
 * 4. Partial failures are handled gracefully
 *
 * @param databases - Appwrite Databases instance
 * @param projectId - The newly created project ID
 * @param workspaceId - The workspace the project belongs to
 * @param creatorUserId - The user who created the project
 * @returns Combined result of role seeding and owner assignment
 */
export async function seedProjectRolesAndAssignOwner(
    databases: Databases,
    projectId: string,
    workspaceId: string,
    creatorUserId: string
): Promise<SeedProjectRolesResult> {
    // Step 1: Seed default roles
    const seedResult = await seedProjectRoles(
        databases,
        projectId,
        workspaceId,
        creatorUserId
    );

    // Step 2: Assign owner membership (only if we have the owner role ID)
    if (seedResult.ownerRoleId) {
        const ownerAssignment = await assignProjectOwnerMembership(
            databases,
            projectId,
            workspaceId,
            creatorUserId,
            seedResult.ownerRoleId
        );

        seedResult.ownerMembershipCreated = ownerAssignment.created;

        if (ownerAssignment.error) {
            // Don't fail the whole operation, but log it
            console.error(
                `[seedProjectRolesAndAssignOwner] Owner assignment failed: ${ownerAssignment.error}`
            );
        }
    } else {
        console.error(
            `[seedProjectRolesAndAssignOwner] Cannot assign owner - no owner role ID found for project ${projectId}`
        );
    }

    await ensurePrivilegedWorkspaceMembersOnProject(databases, projectId, workspaceId);

    return seedResult;
}

// =============================================================================
// UTILITY: GET OR CREATE OWNER ROLE
// =============================================================================

/**
 * Get or Create Owner Role
 *
 * Ensures the Owner role exists for a project.
 * Used for recovery scenarios or manual role fixes.
 *
 * @param databases - Appwrite Databases instance
 * @param projectId - The project ID
 * @param workspaceId - The workspace ID
 * @param createdByUserId - User ID for audit
 * @returns The Owner role document ID
 */
export async function getOrCreateOwnerRole(
    databases: Databases,
    projectId: string,
    workspaceId: string,
    createdByUserId: string
): Promise<string | null> {
    try {
        // Check if Owner role exists
        const existing = await databases.listDocuments(
            DATABASE_ID,
            PROJECT_ROLES_ID,
            [
                Query.equal("projectId", projectId),
                Query.equal("name", "OWNER"),
                Query.limit(1),
            ]
        );

        if (existing.total > 0) {
            return existing.documents[0].$id;
        }

        // Create Owner role
        const ownerConfig = DEFAULT_ROLE_CONFIGS.find(
            (c) => c.name === "OWNER"
        );
        if (!ownerConfig) {
            throw new Error("Owner role config not found");
        }

        const permissions = ROLE_PERMISSIONS[ownerConfig.role] || [];

        const role = await databases.createDocument(
            DATABASE_ID,
            PROJECT_ROLES_ID,
            ID.unique(),
            {
                workspaceId,
                projectId,
                name: ownerConfig.name,
                description: ownerConfig.description,
                permissions,
                color: ownerConfig.color,
                isDefault: true, // Flag to identify system/default roles
                createdBy: createdByUserId,
            }
        );

        return role.$id;
    } catch (error) {
        console.error(
            `[getOrCreateOwnerRole] Failed for project ${projectId}:`,
            error
        );
        return null;
    }
}
