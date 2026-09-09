import { describe, expect, it } from "vitest";

import {
  SANDBOX_WORKSPACE,
  cloneIntoWorkspaceShell,
  createSandboxBranchShell,
  ensureGitInSandboxShell,
  isMissingGitError,
  isSandboxCwdError,
  isSandboxGoneError,
  normalizeSandboxCwd,
  parseGithubHttpsClone,
  parseSandboxSourceMode,
  sandboxHasSourceShell,
  sandboxSessionFailurePresentation,
  wrapSandboxShell,
} from "./workspace";

describe("sandbox workspace shell", () => {
  it("defaults cwd to /workspace and rejects shell metacharacters", () => {
    expect(normalizeSandboxCwd()).toBe(SANDBOX_WORKSPACE);
    expect(normalizeSandboxCwd("/tmp/app")).toBe("/tmp/app");
    expect(normalizeSandboxCwd("/tmp/app/")).toBe("/tmp/app");
    expect(normalizeSandboxCwd("/tmp; rm -rf /")).toBe(SANDBOX_WORKSPACE);
  });

  it("mkdirs then cds so Azure never chdirs to a missing workingDirectory", () => {
    expect(wrapSandboxShell("ls", "/workspace")).toBe('mkdir -p "/workspace" && cd "/workspace" && ls');
    expect(wrapSandboxShell("pwd")).toContain("mkdir -p");
  });

  it("installs git over https apt, clones, and falls back to a GitHub tarball", () => {
    const shell = cloneIntoWorkspaceShell("https://x-access-token:tok@github.com/acme/app.git", "main");
    const ensure = ensureGitInSandboxShell();
    // Azure egress proxy returns 403 for plain http; apt sources must be rewritten to https.
    expect(ensure).toMatch(/sed -i 's\|http:\/\/\|https:\/\/\|g'/);
    expect(ensure).toMatch(/apt-get install .*git/);
    expect(ensure).toMatch(/FAIRLX_GIT_MISSING/);
    expect(shell).toMatch(/git clone --depth 1 --branch "main"/);
    expect(shell).toMatch(/api\.github\.com\/repos\/acme\/app\/tarball\/main/);
    expect(shell).toMatch(/Authorization: Bearer tok/);
    expect(shell).toMatch(/node -e/);
    expect(shell).toMatch(/cp -a \/tmp\/fairlx-src\/\. \/workspace\//);
    expect(shell).toMatch(/test -f \/workspace\/\.fairlx-source/);
    expect(shell).toMatch(/\.git\/info\/exclude/);
    expect(parseGithubHttpsClone("https://x-access-token:tok@github.com/acme/app.git")).toEqual({
      owner: "acme",
      repo: "app",
      token: "tok",
    });
    expect(parseSandboxSourceMode("mode=git\nref=main")).toBe("git");
    expect(parseSandboxSourceMode("mode=tarball\nref=main")).toBe("tarball");
    expect(createSandboxBranchShell("fairlx/epic-1")).toMatch(/git checkout -b "fairlx\/epic-1"/);
    expect(createSandboxBranchShell("fairlx/epic-1")).toMatch(/preview only/);
    expect(sandboxHasSourceShell()).toMatch(/\.fairlx-source/);
  });

  it("detects Azure chdir failures", () => {
    expect(isSandboxCwdError(new Error('chdir to "/workspace": no such file or directory'))).toBe(true);
    expect(isSandboxCwdError("clone ok")).toBe(false);
  });

  it("detects a deleted Azure sandbox so Fairlx can recreate it", () => {
    expect(
      isSandboxGoneError(
        new Error('{"title":"GlobalSandboxNotFound","status":404,"detail":"Sandbox not found"}'),
      ),
    ).toBe(true);
    expect(isSandboxGoneError(new Error("chdir to /workspace"))).toBe(false);
    expect(isSandboxGoneError(new Error("/bin/sh: 1: git: not found"))).toBe(false);
    expect(isMissingGitError("/bin/sh: 1: git: not found")).toBe(true);
    expect(sandboxSessionFailurePresentation("/bin/sh: 1: git: not found").title).toBe("Coding session failed");
    expect(sandboxSessionFailurePresentation("GlobalSandboxNotFound").title).toBe("Sandbox was deleted");
  });
});
