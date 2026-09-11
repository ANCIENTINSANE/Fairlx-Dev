import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("update-docs-from-git", () => {
  it("rewrites changelog.md from git history and leaves README.md alone", () => {
    const readmeBefore = readFileSync(join(ROOT, "README.md"), "utf8");
    execFileSync("node", ["scripts/update-docs-from-git.mjs", "--push"], { cwd: ROOT });

    const changelog = readFileSync(join(ROOT, "changelog.md"), "utf8");
    expect(changelog).toMatch(/^# Changelog\n/);
    expect(changelog).toContain("Recent commits");
    expect(changelog).toContain("Last generated:");
    expect(changelog).not.toContain("docs: refresh README and changelog");
    expect(changelog).not.toContain("docs: refresh changelog");

    const readmeAfter = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readmeAfter).toBe(readmeBefore);
    expect(readmeAfter).not.toContain("<!-- docs:latest:start -->");
    expect(readmeAfter).not.toMatch(/\*\*Latest commits\*\*/);
  });
});
