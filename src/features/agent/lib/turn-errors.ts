import { agentChatTimeoutMs } from "./limits";

export const AGENT_CHAT_TIMEOUT_MS = agentChatTimeoutMs();

export function parseRetryAfterMs(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export function modelHttpError(message: string, status: number, retryAfterHeader?: string | null): Error {
  const error = new Error(message);
  error.name = status === 429 || /rate limit/i.test(message) ? "RateLimitError" : "ModelHttpError";
  Object.assign(error, {
    status,
    retryAfterMs: parseRetryAfterMs(retryAfterHeader),
  });
  return error;
}

export function isContextLengthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /context.?length|maximum context|prompt is too long|too many tokens|max(?:imum)? input|input.*(too large|exceed)|exceeds? (the )?model/i.test(
    message,
  );
}

export function isRateLimitError(error: unknown): boolean {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : 0;
  if (status === 429) return true;
  const name = error instanceof Error ? error.name : "";
  if (name === "RateLimitError") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /rate limit|too many requests|\b429\b|quota.*(exceeded|exhausted)|throttl/i.test(message);
}

export function modelErrorRetryDelayMs(error: unknown, attempt: number): number {
  const retryAfter =
    typeof error === "object" && error && "retryAfterMs" in error
      ? Number((error as { retryAfterMs?: unknown }).retryAfterMs)
      : 0;
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(Math.max(retryAfter, 500), 30_000);
  }
  if (isRateLimitError(error)) {
    return Math.min(2000 * 2 ** (attempt - 1), 20_000);
  }
  return 400 * attempt;
}

export function isTransientModelFetchError(error: unknown): boolean {
  if (isContextLengthError(error)) return false;
  if (isRateLimitError(error)) return true;
  if (!(error instanceof Error)) {
    return /fetch failed|failed to fetch/i.test(String(error));
  }
  if (error.name === "AbortError" || error.name === "TimeoutError") return false;
  const cause =
    "cause" in error && error.cause instanceof Error
      ? `${error.cause.name} ${error.cause.message}`
      : String((error as { cause?: unknown }).cause ?? "");
  const blob = `${error.name} ${error.message} ${cause}`;
  return /fetch failed|failed to fetch|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_|socket hang up|other side closed|EPIPE|network/i.test(
    blob,
  );
}

export async function withTransientFetchRetry<T>(
  run: () => Promise<T>,
  options?: { attempts?: number; shouldRetry?: () => boolean },
): Promise<T> {
  const attempts = options?.attempts ?? 3;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      const retry =
        attempt < attempts &&
        isTransientModelFetchError(error) &&
        (options?.shouldRetry?.() ?? true);
      if (!retry) throw error;
      await new Promise((resolve) => setTimeout(resolve, modelErrorRetryDelayMs(error, attempt)));
    }
  }
  throw last;
}

export function formatAgentTurnError(error: unknown, timeoutMs = AGENT_CHAT_TIMEOUT_MS): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const aborted =
    name === "AbortError" ||
    name === "TimeoutError" ||
    /this operation was aborted/i.test(message) ||
    /aborted due to timeout/i.test(message) ||
    /the operation was aborted/i.test(message);

  if (aborted) {
    return `The model request timed out after ${Math.round(timeoutMs / 1000)}s. Try again.`;
  }

  if (isRateLimitError(error)) {
    return "The worker model hit a rate limit. Wait a few seconds and send the same prompt again.";
  }

  if (isTransientModelFetchError(error) || /fetch failed/i.test(message)) {
    return "The model provider connection dropped. Retry the same message.";
  }

  if (/api deployment for this resource does not exist/i.test(message)) {
    return `${message} Fairlx sent that name as the Azure deployment. AGENT_FOUNDRY_*_AZURE_DEPLOYMENT must be the deployment name (for example gpt-5.6-sol), not an API key. Put keys in AGENT_FOUNDRY_*_AZURE_API_KEY.`;
  }

  if (isContextLengthError(error) || /getting the response from the model/i.test(message)) {
    return "The model could not finish this turn (empty response or context too large after a long tool loop). Retry the same prompt — Fairlx will continue from the sandbox that is already running.";
  }

  return message || "Agent turn failed.";
}
