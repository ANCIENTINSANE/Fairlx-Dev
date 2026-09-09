import { describe, expect, it } from "vitest";

import {
  appDirFromWorkspacePackageJson,
  backgroundStartShell,
  detectPackageManager,
  detectStartCommand,
  healthCheckShell,
  injectListenPort,
  parsePackageJsonScripts,
  previewHostEnvPrefix,
  rankNestedPackageJsonPaths,
} from "./detect-start-command";

describe("detect start command", () => {
  it("prefers pnpm from the lockfile and package.json dev script", () => {
    const detected = detectStartCommand({
      files: {
        "pnpm-lock.yaml": true,
        "package.json": JSON.stringify({ scripts: { dev: "next dev", start: "next start" } }),
      },
      exposePort: 3000,
    });
    expect(detected.packageManager).toBe("pnpm");
    expect(detected.installCommand).toMatch(/pnpm install/);
    expect(detected.startCommand).toMatch(/pnpm dev/);
    expect(detected.startCommand).toMatch(/PORT=3000/);
    expect(detected.source).toBe("package.json");
    expect(detected.runtime).toBe("node");
  });

  it("uses yarn or bun when those lockfiles exist", () => {
    expect(
      detectStartCommand({
        files: { "yarn.lock": true, "package.json": JSON.stringify({ scripts: { dev: "vite" } }) },
      }).packageManager,
    ).toBe("yarn");
    expect(
      detectStartCommand({
        files: { "bun.lock": true, "package.json": JSON.stringify({ scripts: { dev: "bun run src" } }) },
      }).packageManager,
    ).toBe("bun");
  });

  it("detects Django, FastAPI, and Go", () => {
    expect(
      detectStartCommand({
        files: { "manage.py": true, "requirements.txt": "django==5" },
        exposePort: 8000,
      }).startCommand,
    ).toBe("python manage.py runserver 0.0.0.0:8000");
    expect(
      detectStartCommand({
        files: { "pyproject.toml": "[project]\ndependencies=['fastapi']", "requirements.txt": "fastapi\nuvicorn" },
        exposePort: 8080,
      }).startCommand,
    ).toMatch(/uvicorn/);
    expect(detectStartCommand({ files: { "go.mod": true }, exposePort: 4000 }).startCommand).toBe("PORT=4000 go run .");
  });

  it("honors a project start-command override", () => {
    const detected = detectStartCommand({
      files: { "package.json": JSON.stringify({ scripts: { dev: "next dev" } }) },
      prepareScript: "corepack enable && pnpm install",
      startCommand: "pnpm dev --port 4173",
      exposePort: 4173,
    });
    expect(detected.source).toBe("override");
    expect(detected.installCommand).toContain("corepack");
    expect(detected.startCommand).toContain("4173");
  });

  it("injects host/port for Next and Vite without duplicating flags", () => {
    expect(injectListenPort("next dev", 3000)).toBe("next dev -p 3000 -H 0.0.0.0");
    expect(injectListenPort("next dev -p 3000", 3000)).toBe("next dev -p 3000 -H 0.0.0.0");
    expect(injectListenPort("vite", 5173)).toBe("vite --host 0.0.0.0 --port 5173");
  });

  it("parses package.json scripts and builds background/health shells", () => {
    expect(parsePackageJsonScripts("{not json")).toEqual({});
    expect(parsePackageJsonScripts(JSON.stringify({ scripts: { dev: "vite" } }))).toEqual({ dev: "vite" });
    expect(backgroundStartShell("pnpm dev")).toMatch(/nohup sh -c/);
    expect(healthCheckShell(3000)).toContain("FAIRLX_HEALTH_OK");
    expect(healthCheckShell(3000)).toContain("127.0.0.1:3000");
  });

  it("detects package managers from lockfiles", () => {
    expect(detectPackageManager({ "pnpm-lock.yaml": true })).toBe("pnpm");
    expect(detectPackageManager({ "package-lock.json": true })).toBe("npm");
    expect(detectPackageManager({})).toBe("unknown");
  });

  it("forwards host/port flags through npm run for Vite and allow-lists the preview host", () => {
    const detected = detectStartCommand({
      files: { "package.json": JSON.stringify({ scripts: { dev: "vite", build: "tsc && vite build" } }) },
      exposePort: 3000,
      previewHost: "abc.sandbox.example.azure.com",
    });
    expect(detected.startCommand).toBe(
      "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=abc.sandbox.example.azure.com DANGEROUSLY_DISABLE_HOST_CHECK=true HOST=0.0.0.0 PORT=3000 npm run dev -- --port 3000 --host 0.0.0.0",
    );
    expect(detected.port).toBe(3000);
    const pinned = detectStartCommand({
      files: { "package.json": JSON.stringify({ scripts: { dev: "vite --port 5173" } }) },
      exposePort: 3000,
    });
    expect(pinned.port).toBe(5173);
    expect(pinned.startCommand).toBe("HOST=0.0.0.0 PORT=5173 npm run dev -- --host 0.0.0.0");
    expect(backgroundStartShell("HOST=0.0.0.0 PORT=3000 npm run dev")).not.toContain("exec ");
    expect(previewHostEnvPrefix("https://evil;rm -rf /")).toBe("");
  });

  it("ranks a packages/landing-page app ahead of other nested package.json files", () => {
    expect(
      rankNestedPackageJsonPaths([
        "/workspace/packages/landing-page/package.json",
        "/workspace/packages/shared/package.json",
        "/workspace/package.json",
      ]),
    ).toEqual(["/workspace/packages/landing-page/package.json", "/workspace/packages/shared/package.json"]);
    expect(appDirFromWorkspacePackageJson("/workspace/packages/landing-page/package.json")).toBe(
      "packages/landing-page",
    );
    expect(
      detectStartCommand({
        files: {
          appDir: "packages/landing-page",
          "package.json": JSON.stringify({ scripts: { dev: "vite" } }),
        },
        exposePort: 3000,
      }).appDir,
    ).toBe("packages/landing-page");
  });
});
