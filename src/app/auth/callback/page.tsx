"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useCurrent } from "@/features/auth/api/use-current";
import { client } from "@/lib/rpc";
import { routes } from "@/lib/routes";

/**
 * Post-Auth Callback Resolver
 * 
 * This page is the SINGLE entry point after ALL authentication methods:
 * - Email/Password login
 * - Google OAuth
 * - GitHub OAuth
 * - Email verification
 * - Magic link first login
 * 
 * ROLE-AWARE ROUTING LOGIC:
 * 
 * | Account Type | Org Role | Has Workspace | Route                    |
 * |--------------|----------|---------------|--------------------------|
 * | None         | -        | -             | /onboarding              |
 * | PERSONAL     | -        | No            | /onboarding              |
 * | PERSONAL     | -        | Yes           | /agent/dashboard         |
 * | ORG          | OWNER    | No            | /onboarding              |
 * | ORG          | OWNER    | Yes           | /agent/dashboard         |
 * | ORG          | !OWNER   | No            | /welcome (RESTRICTED)    |
 * | ORG          | !OWNER   | Yes           | /agent/dashboard         |
 * 
 * CRITICAL: Non-OWNER org members NEVER see onboarding.
 */

interface UserState {
    accountType: "PERSONAL" | "ORG" | null;
    orgRole: "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER" | null;
    defaultWorkspaceId: string | null;
    orgSetupComplete: boolean;
    needsOnboarding: boolean;
    emailVerified: boolean;
    isByob: boolean;
    byobOrgSlug?: string;
}

async function fetchUserState(): Promise<UserState | null> {
    try {
        // Fetch current user
        const userResponse = await client.api.auth.current.$get();
        if (!userResponse.ok) {
            return null;
        }
        const { data: user } = await userResponse.json();
        if (!user) {
            return null;
        }

        const prefs = user.prefs || {};
        const emailVerified = user.emailVerification === true;
        const accountType = prefs.accountType as "PERSONAL" | "ORG" | null ?? null;
        const orgSetupComplete = prefs.orgSetupComplete === true;
        const byobOrgSlug = prefs.byobOrgSlug as string | undefined;
        
        // Get stored default workspace preference
        const storedDefaultWorkspaceId = prefs.defaultWorkspaceId as string | null ?? null;

        // Check if user needs onboarding (new user without account type)
        const needsOnboarding = !accountType && !prefs.signupCompletedAt;

        // ─── BYOB Users: Special routing path ─────────────────────────────
        // BYOB users have their org/workspace on customer Appwrite, not Cloud.
        // The lifecycle endpoint cannot determine their state correctly (it queries
        // Cloud Appwrite which has no record of the BYOB org or workspaces).
        // We skip the lifecycle call entirely and route based on workspace existence.
        if (byobOrgSlug) {
            let defaultWorkspaceId: string | null = storedDefaultWorkspaceId;

            try {
                const workspacesResponse = await client.api.workspaces.$get();
                if (workspacesResponse.ok) {
                    const { data: workspaces } = await workspacesResponse.json();
                    if (workspaces?.documents?.length > 0) {
                        if (!defaultWorkspaceId) {
                            defaultWorkspaceId = workspaces.documents[0].$id;
                        } else if (!workspaces.documents.some((w: { $id: string }) => w.$id === defaultWorkspaceId)) {
                            defaultWorkspaceId = workspaces.documents[0].$id;
                        }
                    }
                }
            } catch {
                // Non-fatal — fallback to onboarding
            }

            return {
                accountType: "ORG",
                orgRole: "OWNER",     // BYOB users are always their org's owner (for routing purposes)
                defaultWorkspaceId,
                orgSetupComplete,
                needsOnboarding: false, // BYOB never goes through Cloud onboarding
                emailVerified,
                isByob: true,
                byobOrgSlug,
            };
        }
        // ─── End BYOB path ─────────────────────────────────────────────────

        // ─── Cloud Users: Standard routing path (unchanged) ────────────────
        // For ORG accounts, fetch org membership to get role
        let orgRole: "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER" | null = null;

        if (accountType === "ORG") {
            try {
                const lifecycleResponse = await client.api.auth.lifecycle.$get();
                if (lifecycleResponse.ok) {
                    const { data: lifecycle } = await lifecycleResponse.json();
                    orgRole = lifecycle?.orgRole as typeof orgRole ?? null;
                }
            } catch {
                // Lifecycle fetch failed, treat as unknown role
            }
        }

        // Try to get default workspace
        // Priority: 1) Stored preference, 2) First workspace in list
        let defaultWorkspaceId: string | null = storedDefaultWorkspaceId;

        try {
            const workspacesResponse = await client.api.workspaces.$get();
            if (workspacesResponse.ok) {
                const { data: workspaces } = await workspacesResponse.json();
                if (workspaces?.documents?.length > 0) {
                    // If no stored preference, use first workspace
                    if (!defaultWorkspaceId) {
                        defaultWorkspaceId = workspaces.documents[0].$id;
                    }
                    // Validate that stored workspace still exists
                    else if (!workspaces.documents.some((w: { $id: string }) => w.$id === defaultWorkspaceId)) {
                        // Stored workspace no longer exists, fallback to first
                        defaultWorkspaceId = workspaces.documents[0].$id;
                    }
                }
            }
        } catch {
            // Workspaces fetch failed
        }

        return {
            accountType,
            orgRole,
            defaultWorkspaceId,
            orgSetupComplete,
            needsOnboarding,
            emailVerified,
            isByob: false,
            byobOrgSlug: undefined,
        };
    } catch {
        return null;
    }
}

export default function AuthCallbackPage() {
    const router = useRouter();
    const { data: user, isPending, isFetching } = useCurrent();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function resolveRoute() {
            // After login the cache can still hold `user: null` while the
            // session refetch is in flight. Wait — do not bounce to sign-in.
            if (isPending || (isFetching && !user)) return;

            // If no user, redirect to sign-in
            if (!user) {
                router.replace("/sign-in");
                return;
            }

            try {
                const state = await fetchUserState();

                if (!state) {
                    setError("Failed to determine user state");
                    return;
                }

                // ============================================================
                // ROUTING DECISION TREE (Role-Aware)
                // ============================================================

                // ─── BYOB routing (takes priority) ─────────────────────────
                if (state.isByob && state.byobOrgSlug) {
                    const orgSlug = state.byobOrgSlug;

                    if (state.defaultWorkspaceId) {
                        // Has workspace → go to it under the orgSlug namespace
                        router.replace(`/${orgSlug}/workspaces/${state.defaultWorkspaceId}`);
                    } else {
                        // No workspace yet → BYOB onboarding
                        router.replace(`/${orgSlug}/onboarding`);
                    }
                    return;
                }
                // ─── End BYOB routing ──────────────────────────────────────

                // 1. No account type → onboarding (new user)
                if (state.needsOnboarding) {
                    router.replace("/onboarding");
                    return;
                }

                // 2. PERSONAL account
                if (state.accountType === "PERSONAL") {
                    if (state.defaultWorkspaceId) {
                        router.replace(routes.agentDashboard());
                    } else {
                        router.replace("/onboarding");
                    }
                    return;
                }

                // 3. ORG account - role-aware routing
                if (state.accountType === "ORG") {
                    // 3a. Has workspace → Agent Home
                    if (state.defaultWorkspaceId) {
                        router.replace(routes.agentDashboard());
                        return;
                    }

                    // 3b. No workspace - check role
                    if (state.orgRole === "OWNER") {
                        // OWNER without workspace → main onboarding flow
                        router.replace("/onboarding");
                    } else {
                        // NON-OWNER without workspace → /welcome (RESTRICTED MODE)
                        // They will see the restricted welcome page
                        router.replace("/welcome");
                    }
                    return;
                }

                // Fallback: Unknown state → onboarding
                router.replace("/onboarding");
            } catch {
                setError("An error occurred during authentication");
            }
        }

        resolveRoute();
    }, [user, isPending, isFetching, router]);

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen gap-4">
                <p className="text-destructive">{error}</p>
                <button
                    onClick={() => router.replace("/sign-in")}
                    className="text-primary underline"
                >
                    Return to Sign In
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Signing you in...</p>
        </div>
    );
}

