/**
 * Canonical origin for Appwrite Auth OAuth success/failure URLs.
 * Appwrite 1.9 only allows hostnames registered as Web platforms.
 * Never use a tunnel / LAN Origin header — that 412s as "Invalid redirect".
 */
export function sanitizeOrigin(value?: string | null): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname) return "";
    return `${url.protocol}//${url.host}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function hostnameFromOrigin(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return "";
  }
}

export function resolveOAuthRedirectOrigin(input: {
  requestOrigin?: string | null;
  appUrl?: string | null;
}): string {
  const appUrl = sanitizeOrigin(input.appUrl);
  if (appUrl) return appUrl;

  const request = sanitizeOrigin(input.requestOrigin);
  if (request && !/0\.0\.0\.0|127\.0\.0\.1|\[::1\]/i.test(request)) {
    return request;
  }

  throw new Error("Unable to determine app origin. Set NEXT_PUBLIC_APP_URL.");
}

export function appwriteConsoleUrl(endpoint?: string | null): string {
  const raw = (endpoint || "").trim().replace(/\/v1\/?$/, "");
  if (!raw) return "your Appwrite Console";
  return raw;
}

export function invalidOAuthRedirectMessage(params: {
  origin: string;
  endpoint?: string | null;
  detail?: string;
}): string {
  const host = hostnameFromOrigin(params.origin) || params.origin;
  const consoleUrl = appwriteConsoleUrl(params.endpoint);
  const extra = params.detail?.trim() && !/^invalid redirect$/i.test(params.detail.trim())
    ? ` ${params.detail.trim()}`
    : "";
  return (
    `Appwrite rejected the GitHub redirect to ${params.origin}.${extra} ` +
    `Add a Web platform for hostname "${host}" in ${consoleUrl} ` +
    `(project → Overview → Integrations → Platforms), then try again.`
  );
}

export function isAppwriteInvalidRedirect(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as { code?: number; message?: string; type?: string };
  if (rec.code === 412) return true;
  return /invalid redirect/i.test(rec.message || "");
}
