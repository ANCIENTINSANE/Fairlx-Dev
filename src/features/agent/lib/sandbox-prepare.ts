import type { SandboxDriver } from "./sandbox/types";
import { redactSecrets } from "./sandbox/types";
import {
  appDirFromWorkspacePackageJson,
  backgroundStartShell,
  detectStartCommand,
  healthCheckShell,
  parsePackageJsonScripts,
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

export async function probeWorkspaceFiles(driver: SandboxDriver, sandboxId: string): Promise<{
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
}> {
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
  const install = await params.driver.exec(params.sandboxId, detected.installCommand, cwd);
  const start = await params.driver.exec(
    params.sandboxId,
    backgroundStartShell(detected.startCommand),
    cwd,
  );
  const health = await params.driver.exec(params.sandboxId, healthCheckShell(detected.port), cwd);
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
