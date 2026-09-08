import { describe, expect, it } from "vitest";

import {
  githubTokenFromAppwriteRecords,
  githubTokenStillValid,
  isGithubProvider,
  lookupAppwriteGithubAuth,
} from "../lib/github-appwrite-auth";

describe("Appwrite GitHub login vs Fairlx GitHub API", () => {
  it("treats github as the Appwrite provider name", () => {
    expect(isGithubProvider("github")).toBe(true);
    expect(isGithubProvider("GitHub")).toBe(true);
    expect(isGithubProvider("google")).toBe(false);
  });

  it("reads the provider access token from a GitHub login session", () => {
    expect(
      githubTokenFromAppwriteRecords([
        { provider: "email" },
        {
          provider: "github",
          providerAccessToken: "gho_login_token",
          providerUid: "123",
        },
      ]),
    ).toEqual({ token: "gho_login_token", githubUserId: "123" });
  });

  it("skips expired GitHub provider tokens", () => {
    expect(githubTokenStillValid("2000-01-01T00:00:00.000Z")).toBe(false);
    expect(
      githubTokenFromAppwriteRecords([
        {
          provider: "github",
          providerAccessToken: "gho_old",
          providerAccessTokenExpiry: "2000-01-01T00:00:00.000Z",
        },
      ]),
    ).toBeNull();
  });

  it("finds a GitHub identity even when the token lives on the session", async () => {
    const found = await lookupAppwriteGithubAuth(
      {
        listIdentities: async () => ({
          identities: [{ provider: "github", providerUid: "99" }],
        }),
        listSessions: async () => ({
          sessions: [{ provider: "github", providerAccessToken: "gho_from_session", providerUid: "99" }],
        }),
      },
      "user_1",
    );
    expect(found.identityLinked).toBe(true);
    expect(found.token).toBe("gho_from_session");
  });
});
