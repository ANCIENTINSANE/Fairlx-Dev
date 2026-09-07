import { describe, expect, it } from "vitest";

import {
  decodeGitHubContentsPath,
  encodeGitHubContentsPath,
  listGitTreeChildren,
} from "../lib/github-api";

describe("GitHub contents paths", () => {
  it("keeps Next.js route-group parentheses unencoded", () => {
    expect(encodeGitHubContentsPath("src/app/(portal)")).toBe("src/app/(portal)");
    expect(encodeGitHubContentsPath("src/app/(auth)")).toBe("src/app/(auth)");
  });

  it("encodes catch-all brackets once", () => {
    expect(encodeGitHubContentsPath("src/app/api/v1/[[...route]]/routes/students.ts")).toBe(
      "src/app/api/v1/%5B%5B...route%5D%5D/routes/students.ts",
    );
  });

  it("decodes an already-encoded path before encoding so it is not double-encoded", () => {
    expect(decodeGitHubContentsPath("src/app/%28portal%29")).toBe("src/app/(portal)");
    expect(encodeGitHubContentsPath("src/app/%28portal%29")).toBe("src/app/(portal)");
    expect(encodeGitHubContentsPath("src/app/api/v1/%5B%5B...route%5D%5D/routes/students.ts")).toBe(
      "src/app/api/v1/%5B%5B...route%5D%5D/routes/students.ts",
    );
  });

  it("strips a leading slash", () => {
    expect(encodeGitHubContentsPath("/src/middleware.ts")).toBe("src/middleware.ts");
  });

  it("lists immediate children from a git tree, including route groups", () => {
    const tree = [
      { path: "src/app/(portal)/page.tsx", type: "blob", sha: "a", size: 10 },
      { path: "src/app/(auth)/login/page.tsx", type: "blob", sha: "b", size: 11 },
      { path: "src/app/layout.tsx", type: "blob", sha: "c", size: 12 },
      { path: "src/app/api/v1/[[...route]]/routes/students.ts", type: "blob", sha: "d", size: 13 },
    ];
    const root = listGitTreeChildren(tree, "src/app");
    expect(root.map((item) => item.name).sort()).toEqual(["(auth)", "(portal)", "api", "layout.tsx"]);
    expect(root.find((item) => item.name === "(portal)")?.type).toBe("dir");
    expect(root.find((item) => item.name === "layout.tsx")?.type).toBe("file");
    const api = listGitTreeChildren(tree, "src/app/api/v1");
    expect(api).toEqual([
      {
        name: "[[...route]]",
        path: "src/app/api/v1/[[...route]]",
        type: "dir",
        size: 0,
        sha: "d",
      },
    ]);
  });
});
