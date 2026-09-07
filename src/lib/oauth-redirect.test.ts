import { describe, expect, it } from "vitest";

import {
  appwriteConsoleUrl,
  invalidOAuthRedirectMessage,
  isAppwriteInvalidRedirect,
  resolveOAuthRedirectOrigin,
  sanitizeOrigin,
} from "./oauth-redirect";

describe("oauth redirect origin", () => {
  it("prefers NEXT_PUBLIC_APP_URL over a request Origin", () => {
    expect(
      resolveOAuthRedirectOrigin({
        requestOrigin: "https://tunnel.example.dev",
        appUrl: "http://localhost:3000/",
      }),
    ).toBe("http://localhost:3000");
  });

  it("rejects bind addresses when falling back to Origin", () => {
    expect(() =>
      resolveOAuthRedirectOrigin({
        requestOrigin: "http://127.0.0.1:3000",
        appUrl: "",
      }),
    ).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("sanitizes http(s) origins only", () => {
    expect(sanitizeOrigin("http://localhost:3000/oauth")).toBe("http://localhost:3000");
    expect(sanitizeOrigin("javascript:alert(1)")).toBe("");
  });

  it("builds a console platforms hint for 412s", () => {
    expect(appwriteConsoleUrl("https://appwrite.fairlx.com/v1")).toBe("https://appwrite.fairlx.com");
    expect(
      invalidOAuthRedirectMessage({
        origin: "http://localhost:3000",
        endpoint: "https://appwrite.fairlx.com/v1",
      }),
    ).toMatch(/hostname "localhost"/);
    expect(isAppwriteInvalidRedirect({ code: 412, message: "Invalid redirect" })).toBe(true);
  });
});
