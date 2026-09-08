import { describe, expect, it } from "vitest";

import { redactSecrets } from "./sandbox/types";
import { isProjectSecretName, redactSecretMap } from "./project-secrets";

describe("secret redaction", () => {
  it("redacts GitHub, Anthropic, and OpenAI tokens", () => {
    expect(redactSecrets("x-access-token:gho_secret@github.com")).toContain("x-access-token:***@");
    expect(redactSecrets("ANTHROPIC_API_KEY=sk-ant-secretvalue")).toBe("ANTHROPIC_API_KEY=***");
    expect(redactSecrets("token sk-abcdefghijklmnopqrstuvwxyz123456")).toContain("sk-***");
  });

  it("redacts injected project secret values without logging them", () => {
    const text = redactSecretMap("DATABASE_URL=postgres://user:supersecretvalue@db/app", {
      DATABASE_URL: "postgres://user:supersecretvalue@db/app",
    });
    expect(text).not.toContain("supersecretvalue");
    expect(text).toContain("***");
  });

  it("accepts GitHub Actions-style secret names", () => {
    expect(isProjectSecretName("NPM_TOKEN")).toBe(true);
    expect(isProjectSecretName("not valid")).toBe(false);
  });
});
