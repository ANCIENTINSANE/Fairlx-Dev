import { describe, expect, it } from "vitest";

import { githubArtifactFromPayload, githubArtifactsFromEvents } from "./github-artifacts";
import type { AgentToolEvent } from "../types";

describe("github artifacts", () => {
  it("builds a clickable blob URL from a write-file payload", () => {
    const artifact = githubArtifactFromPayload("e1", {
      owner: "ANCIENTINSANE",
      repo: "agent-harness",
      path: "README.md",
      branch: "main",
      html_url: "https://github.com/ANCIENTINSANE/agent-harness/blob/main/README.md",
    });
    expect(artifact).toEqual({
      id: "e1",
      label: "README.md",
      href: "https://github.com/ANCIENTINSANE/agent-harness/blob/main/README.md",
      kind: "file",
    });
  });

  it("collects file artifacts from run events", () => {
    const events: AgentToolEvent[] = [
      {
        id: "1",
        type: "github_write_file",
        title: "Wrote README.md",
        payload: {
          path: "README.md",
          owner: "ANCIENTINSANE",
          repo: "agent-harness",
          html_url: "https://github.com/ANCIENTINSANE/agent-harness/blob/main/README.md",
        },
        createdAt: new Date().toISOString(),
        runId: "r1",
      },
    ];
    expect(githubArtifactsFromEvents(events)[0]?.label).toBe("README.md");
  });

  it("surfaces a coding-session preview URL as an Open CTA", () => {
    const events: AgentToolEvent[] = [
      {
        id: "p1",
        type: "coding_session_status",
        title: "ready · preview",
        payload: { previewUrl: "https://sandbox.example/preview" },
        createdAt: new Date().toISOString(),
        runId: "r1",
      },
    ];
    expect(githubArtifactsFromEvents(events)).toEqual([
      {
        id: "p1",
        label: "Preview",
        href: "https://sandbox.example/preview",
        kind: "preview",
      },
    ]);
  });

  it("labels stub sandbox URLs so they are not shown as live previews", () => {
    const events: AgentToolEvent[] = [
      {
        id: "p2",
        type: "coding_session_start",
        title: "queued",
        payload: { previewUrl: "https://preview.stub.fairlx.local/stub-1/3000" },
        createdAt: new Date().toISOString(),
        runId: "r1",
      },
    ];
    expect(githubArtifactsFromEvents(events)[0]).toMatchObject({
      label: "Stub preview (Azure not configured)",
      kind: "preview",
    });
  });
});
