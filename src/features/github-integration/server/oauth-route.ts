import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { DATABASE_ID, PROJECTS_ID } from "@/config";
import { sessionMiddleware } from "@/lib/session-middleware";

import { oauthAuthorizeSchema, oauthCallbackSchema } from "../schemas";
import type { GitHubOAuthState } from "../types";
import {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  isGitHubOAuthConfigured,
} from "../constants.server";
import { GITHUB_OAUTH_SCOPES, upsertGithubAccount } from "../lib/github-accounts";
import { linkGithubRepoToProject } from "../lib/github-link";
import { userCanManageProjectGithub } from "../lib/github-permissions";
import { githubAPI } from "../lib/github-api";
import { isEncryptionConfigured } from "../lib/encryption";

const GITHUB_OAUTH_BASE = "https://github.com/login/oauth";

function encodeOAuthState(state: GitHubOAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

function decodeOAuthState(encoded: string): GitHubOAuthState {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    return JSON.parse(json) as GitHubOAuthState;
  } catch {
    throw new Error("Invalid OAuth state parameter");
  }
}

function safeReturnTo(value?: string): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}

const app = new Hono()
  /**
   * GET /authorize — Start the OAuth 2.0 flow.
   * Account-global: any signed-in user can connect GitHub. Project linking stays admin-gated.
   */
  .get(
    "/authorize",
    sessionMiddleware,
    zValidator("query", oauthAuthorizeSchema),
    async (c) => {
      const user = c.get("user");
      const { projectId, githubUrl, branch, runId, returnTo } = c.req.valid("query");

      if (!isGitHubOAuthConfigured()) {
        return c.json(
          { error: "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET." },
          501
        );
      }

      const databases = c.get("databases");

      if (projectId && githubUrl) {
        const project = await databases.getDocument(DATABASE_ID, PROJECTS_ID, projectId);
        if (!project) {
          return c.json({ error: "Project not found" }, 404);
        }
        const { resolveUserProjectAccess } = await import("@/lib/permissions/resolveUserProjectAccess");
        const access = await resolveUserProjectAccess(databases, user.$id, projectId);
        if (!access.isAdmin) {
          return c.json(
            { error: "Only project admins can link a repository via OAuth" },
            403
          );
        }
      }

      const state = encodeOAuthState({
        userId: user.$id,
        timestamp: Date.now(),
        projectId,
        githubUrl,
        branch,
        runId,
        returnTo: safeReturnTo(returnTo),
      });

      const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/github/oauth/callback`;
      const githubAuthUrl = new URL(`${GITHUB_OAUTH_BASE}/authorize`);
      githubAuthUrl.searchParams.set("client_id", GITHUB_CLIENT_ID);
      githubAuthUrl.searchParams.set("redirect_uri", redirectUri);
      githubAuthUrl.searchParams.set("scope", GITHUB_OAUTH_SCOPES);
      githubAuthUrl.searchParams.set("state", state);

      return c.redirect(githubAuthUrl.toString());
    }
  )

  /**
   * GET /callback — Exchange the code, store a Fairlx-wide GitHub account, optionally link a project repo.
   */
  .get(
    "/callback",
    sessionMiddleware,
    zValidator("query", oauthCallbackSchema),
    async (c) => {
      const user = c.get("user");
      const databases = c.get("databases");
      const { code, state } = c.req.valid("query");
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";

      let oauthState: GitHubOAuthState;
      try {
        oauthState = decodeOAuthState(state);
      } catch {
        return c.redirect(`${appUrl}?error=invalid_oauth_state`);
      }

      if (oauthState.userId !== user.$id) {
        return c.redirect(`${appUrl}?error=oauth_user_mismatch`);
      }

      if (Date.now() - oauthState.timestamp > 10 * 60 * 1000) {
        return c.redirect(`${appUrl}?error=oauth_state_expired`);
      }

      const { projectId, githubUrl, branch, runId } = oauthState;

      const tokenResponse = await fetch(`${GITHUB_OAUTH_BASE}/access_token`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code,
        }),
      });

      if (!tokenResponse.ok) {
        console.error("[GitHub OAuth] Token exchange failed:", tokenResponse.statusText);
        return c.redirect(`${appUrl}?error=oauth_token_exchange_failed`);
      }

      const tokenData = await tokenResponse.json() as {
        access_token?: string;
        scope?: string;
        error?: string;
        error_description?: string;
      };

      if (tokenData.error || !tokenData.access_token) {
        console.error("[GitHub OAuth] Token error:", tokenData.error, tokenData.error_description);
        return c.redirect(`${appUrl}?error=oauth_token_error`);
      }

      const accessToken = tokenData.access_token;
      const account = await upsertGithubAccount(databases, {
        userId: user.$id,
        token: accessToken,
        authMethod: "oauth",
        scopes: tokenData.scope || GITHUB_OAUTH_SCOPES,
      });
      const githubUsername = account?.githubLogin || "unknown";

      if (projectId && githubUrl) {
        try {
          const canAttach = await userCanManageProjectGithub(databases, user.$id, projectId);
          if (canAttach) {
            const parsed = githubAPI.parseGitHubUrl(githubUrl);
            await linkGithubRepoToProject({
              databases,
              userId: user.$id,
              projectId,
              owner: parsed.owner,
              repo: parsed.repo,
              branch: branch || "main",
            });
          }
        } catch (error) {
          console.error("[GitHub OAuth] Project link after account connect failed:", error);
        }
      }

      if (runId) {
        try {
          const { getRun, updateRun } = await import("@/features/agent/lib/runs");
          const { scheduleAgentTurn } = await import("@/features/agent/lib/schedule-turn");
          const existing = await getRun(databases, user.$id, runId);
          if (existing?.status === "awaiting_plugin") {
            const run = await updateRun(databases, runId, {
              status: "running",
              error: "",
              events: [
                ...existing.events,
                {
                  id: crypto.randomUUID(),
                  type: "plugin_connected",
                  title: `Connected GitHub as @${githubUsername}`,
                  createdAt: new Date().toISOString(),
                  runId: existing.id,
                },
              ],
            });
            scheduleAgentTurn({ databases, user, run });
          }
        } catch (error) {
          console.error("[GitHub OAuth] Failed to resume agent run:", error);
        }
        return c.redirect(`${appUrl}/agent/workflow?runId=${encodeURIComponent(runId)}&oauth=success&github_user=${encodeURIComponent(githubUsername)}`);
      }

      if (projectId) {
        try {
          const project = await databases.getDocument(DATABASE_ID, PROJECTS_ID, projectId);
          const redirectUrl = `${appUrl}/workspaces/${project.workspaceId}/projects/${projectId}/settings?tab=integrations&oauth=success&github_user=${encodeURIComponent(githubUsername)}`;
          return c.redirect(redirectUrl);
        } catch {
          // Fall through to generic success.
        }
      }

      const returnTo = safeReturnTo(oauthState.returnTo);
      if (returnTo) {
        const joiner = returnTo.includes("?") ? "&" : "?";
        return c.redirect(`${appUrl}${returnTo}${joiner}oauth=success&github_user=${encodeURIComponent(githubUsername)}`);
      }

      return c.redirect(`${appUrl}/agent/integrations?oauth=success&github_user=${encodeURIComponent(githubUsername)}`);
    }
  )

  /**
   * GET /status — Check if GitHub OAuth is configured.
   */
  .get("/status", async (c) => {
    return c.json({
      oauthConfigured: isGitHubOAuthConfigured(),
      encryptionConfigured: isEncryptionConfigured(),
      scopes: GITHUB_OAUTH_SCOPES,
    });
  });

export default app;
