import { describe, expect, it } from "vitest";

import { NEW_AGENT_TOOL_IDS } from "../constants";
import { mergeEnabledTools } from "./harness";

describe("mergeEnabledTools", () => {
  it("adds newly introduced tools to a harness that already has older new-tool ids", () => {
    const saved = ["github_create_repo", "github_list_repos", "request_capability"];
    const merged = mergeEnabledTools(saved);
    expect(merged).toContain("github_link_repo");
    expect(merged).toContain("github_create_repo");
    for (const id of NEW_AGENT_TOOL_IDS) {
      expect(merged).toContain(id);
    }
  });
});
