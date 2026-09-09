import { describe, expect, it } from "vitest";

import { resolveAgentProjectId } from "./project-scope";

describe("resolveAgentProjectId", () => {
  it("inherits fallbacks until the user picks a project", () => {
    expect(resolveAgentProjectId(undefined, ["run-p", "default-p"])).toBe("run-p");
    expect(resolveAgentProjectId("picked", ["run-p"])).toBe("picked");
  });

  it("stays empty when the user selects no project", () => {
    expect(resolveAgentProjectId(null, ["run-p", "default-p"])).toBeUndefined();
    expect(resolveAgentProjectId("", ["run-p"])).toBeUndefined();
  });
});
