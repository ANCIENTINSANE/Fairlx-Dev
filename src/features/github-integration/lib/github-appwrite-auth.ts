export type AppwriteGithubCredential = {
  provider?: string;
  providerAccessToken?: string;
  providerAccessTokenExpiry?: string;
  providerUid?: string;
};

export type AppwriteUsersGithub = {
  listIdentities: (queries?: string[]) => Promise<{ identities?: AppwriteGithubCredential[] }>;
  listSessions: (userId: string) => Promise<{ sessions?: AppwriteGithubCredential[] }>;
};

export function isGithubProvider(value?: string): boolean {
  return (value || "").trim().toLowerCase() === "github";
}

export function githubTokenStillValid(expiry?: string): boolean {
  const raw = (expiry || "").trim();
  if (!raw) return true;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return true;
  return at > Date.now() + 30_000;
}

export function githubTokenFromAppwriteRecords(
  records: AppwriteGithubCredential[] | undefined,
): { token: string; githubUserId?: string } | null {
  for (const record of records ?? []) {
    if (!isGithubProvider(record.provider)) continue;
    const token = (record.providerAccessToken || "").trim();
    if (!token || !githubTokenStillValid(record.providerAccessTokenExpiry)) continue;
    return {
      token,
      githubUserId: (record.providerUid || "").trim() || undefined,
    };
  }
  return null;
}

export async function lookupAppwriteGithubAuth(
  users: AppwriteUsersGithub,
  userId: string,
): Promise<{
  token?: string;
  githubUserId?: string;
  identityLinked: boolean;
}> {
  let identityLinked = false;
  let token: string | undefined;
  let githubUserId: string | undefined;

  try {
    const { Query } = await import("node-appwrite");
    const listed = await users.listIdentities([Query.equal("userId", userId), Query.limit(20)]);
    const identities = listed.identities ?? [];
    identityLinked = identities.some((item) => isGithubProvider(item.provider));
    const fromIdentity = githubTokenFromAppwriteRecords(identities);
    if (fromIdentity) {
      token = fromIdentity.token;
      githubUserId = fromIdentity.githubUserId;
    }
  } catch {
    // Fall through to sessions.
  }

  if (!token) {
    try {
      const listed = await users.listSessions(userId);
      const sessions = listed.sessions ?? [];
      identityLinked = identityLinked || sessions.some((item) => isGithubProvider(item.provider));
      const fromSession = githubTokenFromAppwriteRecords(sessions);
      if (fromSession) {
        token = fromSession.token;
        githubUserId = githubUserId || fromSession.githubUserId;
      }
    } catch {
      // Ignore — caller treats this as no Appwrite GitHub grant.
    }
  }

  return { token, githubUserId, identityLinked };
}
