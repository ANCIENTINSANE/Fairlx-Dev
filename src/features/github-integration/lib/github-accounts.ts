import { ID, Query, type Databases, type Models, type Users } from "node-appwrite";

import { DATABASE_ID, GITHUB_ACCOUNTS_ID } from "@/config";

import { decryptToken, encryptToken, isEncryptionConfigured } from "./encryption";
import { lookupAppwriteGithubAuth, isGithubProvider } from "./github-appwrite-auth";
import { GitHubAPI } from "./github-api";

/** Classic OAuth App scopes: private repo R/W (includes create), list orgs, manage repo webhooks. */
export const GITHUB_OAUTH_SCOPES = "repo,read:org,admin:repo_hook";

export type GithubAuthMethod = "oauth" | "pat";

export type GithubAccountDoc = Models.Document & {
  userId: string;
  githubLogin?: string;
  githubUserId?: string;
  accessToken?: string;
  authMethod?: GithubAuthMethod;
  scopes?: string;
  status?: "connected" | "error" | "disconnected";
  lastValidatedAt?: string;
};

export type GithubAccountPublic = {
  connected: boolean;
  /** True when Fairlx has a GitHub API token (OAuth or PAT) for repo read/write. */
  hasRepoAccess: boolean;
  /** True when GitHub rejected the stored token (401). The user must sign in again. */
  expired?: boolean;
  githubLogin?: string;
  githubUserId?: string;
  authMethod?: GithubAuthMethod;
  scopes?: string;
};

export type GithubOwner = {
  login: string;
  type: "User" | "Organization";
  role?: string;
};

export type ResolvedGithubToken = {
  token: string;
  source: "account" | "linker";
  githubLogin?: string;
};

function isPlaceholder(value?: string | null): boolean {
  const normalized = (value || "").trim().toLowerCase();
  return !normalized || normalized === "pending" || normalized === "unknown";
}

export function isPendingGithubRepo(repo: {
  githubUrl?: string | null;
  owner?: string | null;
  repositoryName?: string | null;
  status?: string | null;
}): boolean {
  if ((repo.status || "").toLowerCase() === "authenticating") return true;
  if (isPlaceholder(repo.githubUrl) && isPlaceholder(repo.owner) && isPlaceholder(repo.repositoryName)) {
    return true;
  }
  return isPlaceholder(repo.githubUrl) && (isPlaceholder(repo.owner) || isPlaceholder(repo.repositoryName));
}

export function encodeStoredGithubToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "";
  if (isEncryptionConfigured()) return encryptToken(trimmed);
  return trimmed;
}

export function decodeStoredGithubToken(stored?: string | null): string {
  const value = (stored || "").trim();
  if (!value) return "";
  if (value.includes(":")) {
    try {
      return decryptToken(value);
    } catch {
      // Ciphertext is not a GitHub token. Sending it produces 401 Unauthorized.
      return "";
    }
  }
  return value;
}

function toPublic(doc: GithubAccountDoc | null): GithubAccountPublic {
  if (!doc || doc.status === "disconnected" || !doc.accessToken) {
    return { connected: false, hasRepoAccess: false };
  }
  if (doc.status === "error") {
    // GitHub rejected this token. Surface as "not connected" so the Agent pauses with the
    // Sign in with GitHub card, but keep the login so the message can name the account.
    return {
      connected: false,
      hasRepoAccess: false,
      expired: true,
      githubLogin: doc.githubLogin,
      githubUserId: doc.githubUserId,
      authMethod: doc.authMethod,
    };
  }
  return {
    connected: true,
    hasRepoAccess: true,
    githubLogin: doc.githubLogin,
    githubUserId: doc.githubUserId,
    authMethod: doc.authMethod,
    scopes: doc.scopes,
  };
}

export async function getGithubAccountDoc(
  databases: Databases,
  userId: string,
): Promise<GithubAccountDoc | null> {
  try {
    const listed = await databases.listDocuments<GithubAccountDoc>(DATABASE_ID, GITHUB_ACCOUNTS_ID, [
      Query.equal("userId", userId),
      Query.limit(1),
    ]);
    return listed.documents[0] ?? null;
  } catch {
    return null;
  }
}

async function loadAdminUsers(): Promise<Users | null> {
  try {
    const { createAdminClient } = await import("@/lib/appwrite");
    return (await createAdminClient()).users;
  } catch {
    return null;
  }
}

export async function getGithubAccountPublic(
  databases: Databases,
  userId: string,
  users?: Users,
): Promise<GithubAccountPublic> {
  const doc = await getGithubAccountDoc(databases, userId);
  const stored = toPublic(doc);
  if (stored.hasRepoAccess || stored.expired) return stored;

  const appwriteUsers = users ?? (await loadAdminUsers());
  if (!appwriteUsers) return stored;
  const found = await lookupAppwriteGithubAuth(appwriteUsers, userId);
  if (!found.identityLinked && !found.token) return stored;

  return {
    connected: true,
    hasRepoAccess: false,
    githubLogin: stored.githubLogin,
    githubUserId: found.githubUserId || stored.githubUserId,
    authMethod: "oauth",
  };
}

export async function resolveUserGithubToken(
  databases: Databases,
  userId: string,
  _projectId?: string,
  users?: Users,
): Promise<ResolvedGithubToken | null> {
  const account = await getGithubAccountDoc(databases, userId);
  const accountToken = decodeStoredGithubToken(account?.accessToken);
  const expired = account?.status === "error";
  if (accountToken && account?.status !== "disconnected" && !expired) {
    return {
      token: accountToken,
      source: "account",
      githubLogin: account?.githubLogin,
    };
  }

  const appwriteUsers = users ?? (await loadAdminUsers());
  if (appwriteUsers) {
    const found = await lookupAppwriteGithubAuth(appwriteUsers, userId);
    // The Appwrite identity token is often the very token GitHub just rejected. Only use it
    // when it is different from the one marked expired, otherwise we would loop on 401.
    if (found.token && !(expired && found.token === accountToken)) {
      const persisted = await upsertGithubAccount(databases, {
        userId,
        token: found.token,
        authMethod: "oauth",
        githubUserId: found.githubUserId,
      });
      return {
        token: found.token,
        source: "account",
        githubLogin: persisted?.githubLogin,
      };
    }
  }

  // No server-wide PAT fallback on purpose: a PAT in .env belongs to whoever created it and
  // silently changes the identity every GitHub call runs as (and 404s on private repos it
  // cannot see). Code actions must run as the signed-in user's GitHub account.
  return null;
}

/** GitHub returned 401 for the stored token. Keep the login, drop repo access, force re-login. */
export async function markGithubAccountExpired(databases: Databases, userId: string): Promise<void> {
  const existing = await getGithubAccountDoc(databases, userId);
  if (!existing || existing.status === "error" || existing.status === "disconnected") return;
  try {
    await databases.updateDocument(DATABASE_ID, GITHUB_ACCOUNTS_ID, existing.$id, {
      status: "error",
      lastValidatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn("[GitHub Account] Failed to mark account expired:", error);
  }
}

export async function importGithubAccountFromAppwriteSession(
  databases: Databases,
  userId: string,
  session: { provider?: string; providerAccessToken?: string; providerUid?: string },
): Promise<GithubAccountDoc | null> {
  const token = session.providerAccessToken?.trim();
  if (!isGithubProvider(session.provider) || !token) {
    return null;
  }
  return upsertGithubAccount(databases, {
    userId,
    token,
    authMethod: "oauth",
    githubUserId: session.providerUid,
  });
}

/** Token for project-level GitHub ops (webhooks/sync). Uses the person who attached the repo, never a copied project token. */
export async function resolveLinkedRepoGithubToken(
  databases: Databases,
  repo: { createdBy?: string; lastModifiedBy?: string },
  actingUserId?: string,
): Promise<ResolvedGithubToken | null> {
  const ids = [actingUserId, repo.lastModifiedBy, repo.createdBy].filter(
    (value, index, list): value is string => Boolean(value) && list.indexOf(value) === index,
  );
  for (const userId of ids) {
    const resolved = await resolveUserGithubToken(databases, userId);
    if (resolved) {
      return { ...resolved, source: userId === actingUserId ? "account" : "linker" };
    }
  }
  return null;
}

export async function upsertGithubAccount(
  databases: Databases,
  params: {
    userId: string;
    token: string;
    authMethod: GithubAuthMethod;
    scopes?: string;
    githubLogin?: string;
    githubUserId?: string;
  },
): Promise<GithubAccountDoc | null> {
  const encoded = encodeStoredGithubToken(params.token);
  if (!encoded) return null;

  let githubLogin = params.githubLogin;
  let githubUserId = params.githubUserId;
  if (!githubLogin) {
    try {
      const profile = await new GitHubAPI(params.token).getAuthenticatedUser();
      githubLogin = profile.login;
      githubUserId = String(profile.id);
    } catch {
      // Keep whatever we already have.
    }
  }

  const payload = {
    userId: params.userId,
    githubLogin: githubLogin || "",
    githubUserId: githubUserId || "",
    accessToken: encoded,
    authMethod: params.authMethod,
    scopes: params.scopes || GITHUB_OAUTH_SCOPES,
    status: "connected" as const,
    lastValidatedAt: new Date().toISOString(),
  };

  try {
    const existing = await getGithubAccountDoc(databases, params.userId);
    if (existing) {
      return await databases.updateDocument<GithubAccountDoc>(
        DATABASE_ID,
        GITHUB_ACCOUNTS_ID,
        existing.$id,
        payload,
      );
    }
    return await databases.createDocument<GithubAccountDoc>(
      DATABASE_ID,
      GITHUB_ACCOUNTS_ID,
      ID.unique(),
      payload,
    );
  } catch (error) {
    console.warn("[GitHub Account] Failed to persist global GitHub account:", error);
    return null;
  }
}

export async function disconnectGithubAccount(databases: Databases, userId: string): Promise<void> {
  const existing = await getGithubAccountDoc(databases, userId);
  if (!existing) return;
  await databases.updateDocument(DATABASE_ID, GITHUB_ACCOUNTS_ID, existing.$id, {
    accessToken: "",
    status: "disconnected",
    lastValidatedAt: new Date().toISOString(),
  });
}

export async function listGithubOwners(token: string): Promise<{ login: string; owners: GithubOwner[] }> {
  const api = new GitHubAPI(token);
  const user = await api.getAuthenticatedUser();
  const orgs = await api.listUserOrganizations();
  const owners: GithubOwner[] = [
    { login: user.login, type: "User" },
    ...orgs.map((org) => ({ login: org.login, type: "Organization" as const })),
  ];
  return { login: user.login, owners };
}
