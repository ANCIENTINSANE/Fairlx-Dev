import type { SandboxDriver } from "./sandbox/types";
import { redactSecrets } from "./sandbox/types";
import {
  appDirFromWorkspacePackageJson,
  backgroundStartShell,
  detectStartCommand,
  healthCheckShell,
  parsePackageJsonScripts,
  quickHealthShell,
  rankNestedPackageJsonPaths,
  type DetectedStartCommand,
} from "./detect-start-command";
import { SANDBOX_WORKSPACE } from "./sandbox/workspace";

export type SandboxPrepareResult = {
  detected: DetectedStartCommand;
  previewLive: boolean;
  install: { stdout: string; stderr: string; exitCode: number };
  start: { stdout: string; stderr: string; exitCode: number };
  health: { stdout: string; stderr: string; exitCode: number };
};

async function fileExists(driver: SandboxDriver, sandboxId: string, path: string): Promise<boolean> {
  const result = await driver.exec(sandboxId, `test -f ${path} && echo yes || echo no`, "/workspace");
  return /^\s*yes\s*$/m.test(result.stdout);
}

async function readOptional(driver: SandboxDriver, sandboxId: string, path: string): Promise<string | undefined> {
  try {
    return await driver.readFile(sandboxId, path);
  } catch {
    const cat = await driver.exec(sandboxId, `cat ${path} 2>/dev/null || true`, "/workspace");
    const text = cat.stdout.trim();
    return text || undefined;
  }
}

export type WorkspaceProbe = {
  "package.json"?: string;
  "pnpm-lock.yaml"?: boolean;
  "yarn.lock"?: boolean;
  "bun.lockb"?: boolean;
  "bun.lock"?: boolean;
  "package-lock.json"?: boolean;
  "poetry.lock"?: boolean;
  "pyproject.toml"?: string;
  "requirements.txt"?: string;
  "go.mod"?: boolean;
  "manage.py"?: boolean;
  appDir?: string;
};

const PROBE_EXISTS = ["poetry.lock", "go.mod", "manage.py", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "package-lock.json"] as const;
const PROBE_READ = ["package.json", "pyproject.toml", "requirements.txt"] as const;

/**
 * One shell round-trip instead of eleven: prints `FAIRLX_EXISTS <name>` for lockfiles and
 * base64 bodies for manifests. Every Azure exec is ~0.5–1.5 s, so this alone saves ~10 s per start.
 */
export function workspaceProbeShell(root = SANDBOX_WORKSPACE): string {
  return [
    `echo FAIRLX_PROBE_BEGIN`,
    `for f in ${PROBE_EXISTS.join(" ")}; do [ -f ${root}/$f ] && echo "FAIRLX_EXISTS $f"; done`,
    `for f in ${PROBE_READ.join(" ")}; do if [ -f ${root}/$f ]; then echo "FAIRLX_FILE $f"; (base64 -w0 ${root}/$f 2>/dev/null || base64 ${root}/$f | tr -d '\\n'); echo; echo FAIRLX_FILE_END; fi; done`,
    `echo FAIRLX_PROBE_END`,
  ].join("\n");
}

export function parseWorkspaceProbe(stdout: string): WorkspaceProbe | null {
  if (!/FAIRLX_PROBE_BEGIN/.test(stdout) || !/FAIRLX_PROBE_END/.test(stdout)) return null;
  const out: WorkspaceProbe = {};
  const lines = stdout.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const exists = line.match(/^FAIRLX_EXISTS (\S+)$/);
    if (exists) {
      (out as Record<string, unknown>)[exists[1]] = true;
      continue;
    }
    const file = line.match(/^FAIRLX_FILE (\S+)$/);
    if (file) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== "FAIRLX_FILE_END") {
        body.push(lines[index].trim());
        index += 1;
      }
      try {
        const text = Buffer.from(body.join(""), "base64").toString("utf8");
        if (text.trim()) (out as Record<string, unknown>)[file[1]] = text;
      } catch {
        /* unreadable manifest; treat as absent */
      }
    }
  }
  for (const name of PROBE_EXISTS) if (!(name in out)) (out as Record<string, unknown>)[name] = false;
  return out;
}

export async function probeWorkspaceFiles(driver: SandboxDriver, sandboxId: string): Promise<WorkspaceProbe> {
  if (driver.kind !== "stub") {
    try {
      const probed = await driver.exec(sandboxId, workspaceProbeShell(), SANDBOX_WORKSPACE);
      const parsed = parseWorkspaceProbe(probed.stdout);
      if (parsed) {
        const rootScripts = parsePackageJsonScripts(parsed["package.json"]);
        const rootRunnable = Boolean(rootScripts.dev || rootScripts.start || rootScripts.preview || rootScripts.serve);
        if (parsed["package.json"]?.trim() && rootRunnable) return parsed;
        const nested = await findNestedAppPackage(driver, sandboxId);
        if (!nested) return parsed;
        const nestedProbe = await driver.exec(sandboxId, workspaceProbeShell(`${SANDBOX_WORKSPACE}/${nested.appDir}`), SANDBOX_WORKSPACE);
        const nestedParsed = parseWorkspaceProbe(nestedProbe.stdout);
        return {
          ...parsed,
          ...(nestedParsed
            ? {
                "pnpm-lock.yaml": nestedParsed["pnpm-lock.yaml"],
                "yarn.lock": nestedParsed["yarn.lock"],
                "bun.lockb": nestedParsed["bun.lockb"],
                "bun.lock": nestedParsed["bun.lock"],
                "package-lock.json": nestedParsed["package-lock.json"],
              }
            : {}),
          "package.json": nested.content,
          appDir: nested.appDir,
        };
      }
    } catch {
      /* fall through to the per-file probe */
    }
  }
  return probeWorkspaceFilesSlow(driver, sandboxId);
}

async function probeWorkspaceFilesSlow(driver: SandboxDriver, sandboxId: string): Promise<WorkspaceProbe> {
  const [poetry, pyproject, requirements, goMod, manage] = await Promise.all([
    fileExists(driver, sandboxId, "/workspace/poetry.lock"),
    readOptional(driver, sandboxId, "/workspace/pyproject.toml"),
    readOptional(driver, sandboxId, "/workspace/requirements.txt"),
    fileExists(driver, sandboxId, "/workspace/go.mod"),
    fileExists(driver, sandboxId, "/workspace/manage.py"),
  ]);
  let [packageJson, pnpm, yarn, bunLockb, bunLock, npmLock] = await Promise.all([
    readOptional(driver, sandboxId, "/workspace/package.json"),
    fileExists(driver, sandboxId, "/workspace/pnpm-lock.yaml"),
    fileExists(driver, sandboxId, "/workspace/yarn.lock"),
    fileExists(driver, sandboxId, "/workspace/bun.lockb"),
    fileExists(driver, sandboxId, "/workspace/bun.lock"),
    fileExists(driver, sandboxId, "/workspace/package-lock.json"),
  ]);
  let appDir: string | undefined;
  const rootScripts = parsePackageJsonScripts(packageJson);
  const rootRunnable = Boolean(rootScripts.dev || rootScripts.start || rootScripts.preview || rootScripts.serve);
  if (!packageJson?.trim() || !rootRunnable) {
    // Empty root or a monorepo root without a dev script: look for the app under packages/ or apps/.
    const nested = await findNestedAppPackage(driver, sandboxId);
    if (nested) {
      packageJson = nested.content;
      appDir = nested.appDir;
      const prefix = `${SANDBOX_WORKSPACE}/${appDir}`;
      [pnpm, yarn, bunLockb, bunLock, npmLock] = await Promise.all([
        fileExists(driver, sandboxId, `${prefix}/pnpm-lock.yaml`),
        fileExists(driver, sandboxId, `${prefix}/yarn.lock`),
        fileExists(driver, sandboxId, `${prefix}/bun.lockb`),
        fileExists(driver, sandboxId, `${prefix}/bun.lock`),
        fileExists(driver, sandboxId, `${prefix}/package-lock.json`),
      ]);
    }
  }
  return {
    "package.json": packageJson,
    "pnpm-lock.yaml": pnpm,
    "yarn.lock": yarn,
    "bun.lockb": bunLockb,
    "bun.lock": bunLock,
    "package-lock.json": npmLock,
    "poetry.lock": poetry,
    "pyproject.toml": pyproject,
    "requirements.txt": requirements,
    "go.mod": goMod,
    "manage.py": manage,
    appDir,
  };
}

async function findNestedAppPackage(
  driver: SandboxDriver,
  sandboxId: string,
): Promise<{ appDir: string; content: string } | null> {
  const listed = await driver.exec(
    sandboxId,
    `find ${SANDBOX_WORKSPACE} -maxdepth 4 -name package.json ! -path '*/node_modules/*' 2>/dev/null | head -40`,
    SANDBOX_WORKSPACE,
  );
  const ranked = rankNestedPackageJsonPaths(listed.stdout.split("\n"));
  for (const path of ranked) {
    const content = await readOptional(driver, sandboxId, path);
    const scripts = parsePackageJsonScripts(content);
    if (scripts.dev || scripts.start || scripts.preview || scripts.serve) {
      const dir = appDirFromWorkspacePackageJson(path);
      if (dir && content) return { appDir: dir, content };
    }
  }
  return null;
}

export async function prepareSandboxApp(params: {
  driver: SandboxDriver;
  sandboxId: string;
  exposePort: number;
  prepareScript?: string;
  startCommand?: string;
  extraSecretValues?: string[];
  /** Public preview hostname so dev servers with host checks (Vite) accept proxied requests. */
  previewHost?: string;
  /** Background shell (nohup'd) launched alongside install — e.g. the Claude Code / Codex CLI prefetch. */
  prefetchShell?: string;
}): Promise<SandboxPrepareResult> {
  const files = await probeWorkspaceFiles(params.driver, params.sandboxId);
  const detected = detectStartCommand({
    files,
    exposePort: params.exposePort,
    prepareScript: params.prepareScript,
    startCommand: params.startCommand,
    previewHost: params.previewHost,
  });

  const emptyWorkspace = detected.source === "fallback" && !files["package.json"];
  if (emptyWorkspace) {
    const skip = {
      stdout: "Empty /workspace (no package.json). Skipping install/start until the agent scaffolds the app.",
      stderr: "",
      exitCode: 0,
    };
    return {
      detected,
      previewLive: false,
      install: skip,
      start: skip,
      health: { stdout: "FAIRLX_HEALTH_FAIL", stderr: "No app to start yet.", exitCode: 1 },
    };
  }

  const cwd = detected.appDir ? `${SANDBOX_WORKSPACE}/${detected.appDir}` : SANDBOX_WORKSPACE;
  // The prefetch is nohup'd and returns immediately, so it overlaps with the dependency install.
  const installShell = params.prefetchShell?.trim()
    ? `${params.prefetchShell.trim()}\n${detected.installCommand}`
    : detected.installCommand;
  const install = await params.driver.exec(params.sandboxId, installShell, cwd);
  // Start the dev server and begin polling in the same shell: one round-trip fewer and the
  // health loop starts the instant the process is detached.
  const startAndHealth = await params.driver.exec(
    params.sandboxId,
    `${backgroundStartShell(detected.startCommand)}\necho FAIRLX_START_END\n${healthCheckShell(detected.port, 120, 1)}`,
    cwd,
  );
  const [startOut = "", healthOut = ""] = startAndHealth.stdout.split(/^FAIRLX_START_END\s*$/m);
  const start = { stdout: startOut.trim(), stderr: "", exitCode: 0 };
  const health = { stdout: healthOut.trim(), stderr: startAndHealth.stderr, exitCode: startAndHealth.exitCode };
  const stub = params.driver.kind === "stub";
  const pool = params.driver.kind === "sessions";
  const previewLive = !stub && !pool && /FAIRLX_HEALTH_OK/.test(health.stdout);

  return {
    detected,
    previewLive,
    install: {
      stdout: redactSecrets(install.stdout, params.extraSecretValues),
      stderr: redactSecrets(install.stderr, params.extraSecretValues),
      exitCode: install.exitCode,
    },
    start: {
      stdout: redactSecrets(start.stdout, params.extraSecretValues),
      stderr: redactSecrets(start.stderr, params.extraSecretValues),
      exitCode: start.exitCode,
    },
    health: {
      stdout: redactSecrets(health.stdout, params.extraSecretValues),
      stderr: redactSecrets(health.stderr, params.extraSecretValues),
      exitCode: health.exitCode,
    },
  };
}

export async function recheckSandboxHealth(params: {
  driver: SandboxDriver;
  sandboxId: string;
  port: number;
  /** When > 1, poll like the initial prepare health check. */
  attempts?: number;
}): Promise<{ live: boolean; stdout: string; stderr: string }> {
  const command = params.attempts && params.attempts > 1 ? healthCheckShell(params.port, params.attempts, 2) : quickHealthShell(params.port);
  const health = await params.driver.exec(params.sandboxId, command, SANDBOX_WORKSPACE);
  return {
    live: /FAIRLX_HEALTH_OK/.test(health.stdout),
    stdout: health.stdout,
    stderr: health.stderr,
  };
}
