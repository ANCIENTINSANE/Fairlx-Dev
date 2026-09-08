import { describe, expect, it } from "vitest";

import {
  formatAgentTurnError,
  isContextLengthError,
  isRateLimitError,
  isTransientModelFetchError,
  modelErrorRetryDelayMs,
  modelHttpError,
} from "./turn-errors";

describe("formatAgentTurnError", () => {
  it("maps AbortError to a timeout message", () => {
    const error = new Error("This operation was aborted");
    error.name = "AbortError";
    expect(formatAgentTurnError(error, 60_000)).toBe(
      "The model request timed out after 60s. Try again."
    );
  });

  it("maps TimeoutError to a timeout message", () => {
    const error = new Error("The operation was aborted due to timeout");
    error.name = "TimeoutError";
    expect(formatAgentTurnError(error)).toMatch(/timed out after \d+s/);
  });

  it("uses an 8-minute default so paid long-context calls are not killed at 60s", () => {
    const error = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(formatAgentTurnError(error, 480_000)).toBe(
      "The model request timed out after 480s. Try again.",
    );
  });

  it("passes through other errors", () => {
    expect(formatAgentTurnError(new Error("No AI model is configured."))).toBe(
      "No AI model is configured."
    );
  });

  it("explains missing Azure deployments when the env var was an API key", () => {
    expect(
      formatAgentTurnError(
        new Error(
          "The API deployment for this resource does not exist. If you created the deployment within the last 5 minutes, please wait a moment and try again.",
        ),
      ),
    ).toMatch(/deployment name \(for example gpt-5\.6-sol\), not an API key/i);
  });

  it("maps DeepSeek Azure rate limits to a retryable message", () => {
    const error = modelHttpError(
      "Your requests to DeepSeek-V4-Flash for DeepSeek-V4-Flash in southindia have exceeded rate limit.",
      429,
    );
    expect(isRateLimitError(error)).toBe(true);
    expect(isTransientModelFetchError(error)).toBe(true);
    expect(formatAgentTurnError(error)).toMatch(/rate limit/i);
    expect(modelErrorRetryDelayMs(error, 1)).toBe(2000);
    expect(modelErrorRetryDelayMs(error, 3)).toBe(8000);
  });
});

describe("isContextLengthError", () => {
  it("detects provider context-window failures and does not treat them as transient", () => {
    const error = new Error("This model's maximum context length is 72000 tokens");
    expect(isContextLengthError(error)).toBe(true);
    expect(isTransientModelFetchError(error)).toBe(false);
  });
});
