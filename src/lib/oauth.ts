// Reference: https://appwrite.io/docs/tutorials/nextjs-ssr-auth/step-7
"use server";

import { createAdminClient, createSessionClient } from "@/lib/appwrite";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { OAuthProvider } from "node-appwrite";

import {
  invalidOAuthRedirectMessage,
  isAppwriteInvalidRedirect,
  resolveOAuthRedirectOrigin,
} from "@/lib/oauth-redirect";

async function getOrigin(): Promise<string> {
  const origin = (await headers()).get("origin");
  return resolveOAuthRedirectOrigin({
    requestOrigin: origin,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  });
}

function isNextRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

async function oauthAccount() {
  try {
    return (await createSessionClient()).account;
  } catch {
    return (await createAdminClient()).account;
  }
}

async function startOAuth(provider: OAuthProvider, returnUrl?: string): Promise<{ error: string } | void> {
  const origin = await getOrigin();
  const failureUrl = returnUrl
    ? `${origin}/sign-up?returnUrl=${encodeURIComponent(returnUrl)}`
    : `${origin}/sign-up`;
  const successUrl = `${origin}/oauth`;

  try {
    const account = await oauthAccount();
    const redirectUrl = await account.createOAuth2Token(provider, successUrl, failureUrl);
    return redirect(redirectUrl);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    if (isAppwriteInvalidRedirect(error)) {
      const detail = error instanceof Error ? error.message : "";
      return {
        error: invalidOAuthRedirectMessage({
          origin,
          endpoint: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
          detail,
        }),
      };
    }
    throw error;
  }
}

/**
 * OAuth with GitHub
 *
 * WHY redirect to /oauth first, then to /auth/callback:
 * - /oauth handles the token exchange (creates session from OAuth token)
 * - /auth/callback handles routing logic (user state-based routing)
 */
export async function signUpWithGithub(returnUrl?: string) {
  return startOAuth(OAuthProvider.Github, returnUrl);
}

export async function signUpWithGoogle(returnUrl?: string) {
  return startOAuth(OAuthProvider.Google, returnUrl);
}
