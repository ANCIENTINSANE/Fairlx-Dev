import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { sessionMiddleware } from "@/lib/session-middleware";

import {
  disconnectGithubAccount,
  getGithubAccountPublic,
  listGithubOwners,
  resolveUserGithubToken,
  upsertGithubAccount,
  GITHUB_OAUTH_SCOPES,
} from "../lib/github-accounts";
import { createGithubRepository, linkGithubRepoToProject } from "../lib/github-link";
import { GitHubAPI } from "../lib/github-api";
import { isGitHubOAuthConfigured } from "../constants.server";

const createRepoSchema = z.object({
  name: z.string().min(1).max(100),
  owner: z.string().optional(),
  description: z.string().max(350).optional(),
  private: z.boolean().optional(),
  autoInit: z.boolean().optional(),
  projectId: z.string().optional(),
  branch: z.string().optional(),
  linkToProject: z.boolean().optional(),
});

const app = new Hono()
  .get("/", sessionMiddleware, async (c) => {
    const user = c.get("user");
    const databases = c.get("databases");
    const account = await getGithubAccountPublic(databases, user.$id);
    return c.json({
      data: account,
      oauthConfigured: isGitHubOAuthConfigured(),
      scopes: GITHUB_OAUTH_SCOPES,
    });
  })

  .post(
    "/token",
    sessionMiddleware,
    zValidator(
      "json",
      z.object({
        token: z.string().min(8),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const databases = c.get("databases");
      const { token } = c.req.valid("json");
      try {
        const api = new GitHubAPI(token.trim());
        await api.getAuthenticatedUser();
      } catch {
        return c.json({ error: "GitHub rejected that token. Use a classic PAT with repo and read:org." }, 400);
      }
      const account = await upsertGithubAccount(databases, {
        userId: user.$id,
        token: token.trim(),
        authMethod: "pat",
        scopes: "repo,read:org",
      });
      return c.json({
        data: {
          connected: true,
          githubLogin: account?.githubLogin,
          authMethod: "pat" as const,
        },
      });
    },
  )

  .delete("/", sessionMiddleware, async (c) => {
    const user = c.get("user");
    const databases = c.get("databases");
    await disconnectGithubAccount(databases, user.$id);
    return c.json({ data: { connected: false } });
  })

  .get("/owners", sessionMiddleware, async (c) => {
    const user = c.get("user");
    const databases = c.get("databases");
    const resolved = await resolveUserGithubToken(databases, user.$id);
    if (!resolved) {
      return c.json({ error: "Connect GitHub first.", code: "github_auth_required" }, 401);
    }
    try {
      const result = await listGithubOwners(resolved.token);
      return c.json({ data: result });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to list GitHub owners" },
        400,
      );
    }
  })

  .get("/repos", sessionMiddleware, async (c) => {
    const user = c.get("user");
    const databases = c.get("databases");
    const projectId = c.req.query("projectId") || undefined;
    const resolved = await resolveUserGithubToken(databases, user.$id, projectId);
    if (!resolved) {
      return c.json({ error: "Connect GitHub first.", code: "github_auth_required" }, 401);
    }
    try {
      const api = new GitHubAPI(resolved.token);
      const repos = await api.listUserRepositories();
      return c.json({ data: repos });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to list repositories" },
        400,
      );
    }
  })

  .post("/repos", sessionMiddleware, zValidator("json", createRepoSchema), async (c) => {
    const user = c.get("user");
    const databases = c.get("databases");
    const json = c.req.valid("json");
    const resolved = await resolveUserGithubToken(databases, user.$id, json.projectId);
    if (!resolved) {
      return c.json({ error: "Connect GitHub first.", code: "github_auth_required" }, 401);
    }

    const owners = await listGithubOwners(resolved.token);
    const requestedOwner = (json.owner || "").trim();
    if (!requestedOwner && owners.owners.length > 1) {
      return c.json({
        error: "Choose a personal account or organization.",
        code: "github_owner_required",
        data: owners,
      }, 409);
    }
    if (requestedOwner && !owners.owners.some((item) => item.login.toLowerCase() === requestedOwner.toLowerCase())) {
      return c.json({
        error: `You cannot create a repository under ${requestedOwner}.`,
        code: "github_owner_forbidden",
        data: owners,
      }, 403);
    }

    try {
      const created = await createGithubRepository({
        token: resolved.token,
        name: json.name.trim(),
        owner: requestedOwner || owners.login,
        description: json.description,
        private: json.private,
        autoInit: json.autoInit,
      });

      let linked: { id: string; projectId: string } | undefined;
      if (json.linkToProject !== false && json.projectId) {
        try {
          const repoDoc = await linkGithubRepoToProject({
            databases,
            userId: user.$id,
            projectId: json.projectId,
            owner: created.owner,
            repo: created.repo,
            branch: json.branch || created.defaultBranch,
          });
          linked = { id: repoDoc.$id, projectId: json.projectId };
        } catch (error) {
          return c.json({
            data: {
              ...created,
              linked: false,
              linkError: error instanceof Error ? error.message : "Created on GitHub but could not link this project.",
            },
          });
        }
      }

      return c.json({ data: { ...created, linked: Boolean(linked), repositoryId: linked?.id } });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to create GitHub repository" },
        400,
      );
    }
  });

export default app;
