import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parsePriority } from "./slack-commands";
import { plainSlackText, slackTextMentionsBot, verifySlackSignature } from "./slack";

function sign(secret: string, timestamp: string, body: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

describe("slack signature", () => {
  const secret = "shh";
  const body = "token=x&command=%2Ffairlx&text=help";
  const now = 1_700_000_000_000;
  const timestamp = String(Math.floor(now / 1000));

  it("accepts a fresh, correctly signed request", () => {
    expect(verifySlackSignature({ rawBody: body, timestamp, signature: sign(secret, timestamp, body), secret, now })).toBe(true);
  });

  it("rejects tampered bodies and stale timestamps", () => {
    expect(verifySlackSignature({ rawBody: body + "&x=1", timestamp, signature: sign(secret, timestamp, body), secret, now })).toBe(false);
    const old = String(Math.floor(now / 1000) - 10 * 60);
    expect(verifySlackSignature({ rawBody: body, timestamp: old, signature: sign(secret, old, body), secret, now })).toBe(false);
  });
});

describe("slack text helpers", () => {
  it("parses priorities out of free text", () => {
    expect(parsePriority("urgent login page crashes")).toEqual({ priority: "URGENT", rest: "login page crashes" });
    expect(parsePriority("add dark mode")).toEqual({ priority: "MEDIUM", rest: "add dark mode" });
  });

  it("detects @Fairlx mentions from bot id or plain text", () => {
    expect(slackTextMentionsBot("<@U0BOT> fix this", "U0BOT")).toBe(true);
    expect(slackTextMentionsBot("hey @fairlx please build it", undefined)).toBe(true);
    expect(slackTextMentionsBot("nothing to see here", "U0BOT")).toBe(false);
    expect(plainSlackText("<@U0BOT> fix <https://x.y|WEB-1>")).toBe("fix WEB-1");
  });
});
