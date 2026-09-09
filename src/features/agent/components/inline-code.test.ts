import { describe, expect, it } from "vitest";
import { classifyInlineCode } from "./inline-code";

describe("classifyInlineCode", () => {
  it("classifies all 5 items from user screenshot correctly", () => {
    // 1. main -> branch
    const branch = classifyInlineCode("main");
    expect(branch.type).toBe("branch");
    expect(branch.tone).toContain("text-purple-600");

    // 2. .github/workflows/deploy-pages.yml -> file (YAML)
    const file = classifyInlineCode(".github/workflows/deploy-pages.yml");
    expect(file.type).toBe("file");
    expect(file.tone).toContain("text-rose-600");

    // 3. https://ANCIENTINSANE.github.io/agent-harness -> url
    const url = classifyInlineCode("https://ANCIENTINSANE.github.io/agent-harness");
    expect(url.type).toBe("url");
    expect(url.href).toBe("https://ANCIENTINSANE.github.io/agent-harness");
    expect(url.tone).toContain("text-sky-600");

    // 4. packages/landing-page -> directory
    const dir = classifyInlineCode("packages/landing-page");
    expect(dir.type).toBe("dir");
    expect(dir.tone).toContain("text-amber-600");
  });

  it("classifies other common dev entities correctly", () => {
    expect(classifyInlineCode("npm run dev").type).toBe("command");
    expect(classifyInlineCode("git checkout -b feature").type).toBe("command");
    expect(classifyInlineCode("App.tsx").type).toBe("file");
    expect(classifyInlineCode("NODE_ENV").type).toBe("env");
    expect(classifyInlineCode("localhost:3000").type).toBe("localhost");
    expect(classifyInlineCode("true").type).toBe("constant");
    expect(classifyInlineCode("404").type).toBe("number");
    expect(classifyInlineCode("useState").type).toBe("code");
  });
});
