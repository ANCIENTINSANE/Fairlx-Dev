import type { SandboxDriver } from "./sandbox/types";
import { redactSecrets } from "./sandbox/types";
import {
  backgroundStartShell,
  detectStartCommand,
  healthCheckShell,
  type DetectedStartCommand,
} from "./detect-start-command";

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
}> {
  const [
    packageJson,
    pnpm,
    yarn,
    bunLockb,
    bunLock,
    npmLock,
    poetry,
    pyproject,
    requirements,
    goMod,
    manage,
  ] = await Promise.all([
    readOptional(driver, sandboxId, "/workspace/package.json"),
    fileExists(driver, sandboxId, "/workspace/pnpm-lock.yaml"),
    fileExists(driver, sandboxId, "/workspace/yarn.lock"),
    fileExists(driver, sandboxId, "/workspace/bun.lockb"),
    fileExists(driver, sandboxId, "/workspace/bun.lock"),
    fileExists(driver, sandboxId, "/workspace/package-lock.json"),
    fileExists(driver, sandboxId, "/workspace/poetry.lock"),
    readOptional(driver, sandboxId, "/workspace/pyproject.toml"),
    readOptional(driver, sandboxId, "/workspace/requirements.txt"),
    fileExists(driver, sandboxId, "/workspace/go.mod"),
    fileExists(driver, sandboxId, "/workspace/manage.py"),
  ]);
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
  };
}

export async function prepareSandboxApp(params: {
  driver: SandboxDriver;
  sandboxId: string;
  exposePort: number;
  prepareScript?: string;
  startCommand?: string;
  extraSecretValues?: string[];
}): Promise<SandboxPrepareResult> {
  const files = await probeWorkspaceFiles(params.driver, params.sandboxId);
  const detected = detectStartCommand({
    files,
    exposePort: params.exposePort,
    prepareScript: params.prepareScript,
    startCommand: params.startCommand,
  });

  const install = await params.driver.exec(params.sandboxId, detected.installCommand, "/workspace");
  const start = await params.driver.exec(
    params.sandboxId,
    backgroundStartShell(detected.startCommand),
    "/workspace",
  );
  const health = await params.driver.exec(params.sandboxId, healthCheckShell(detected.port), "/workspace");
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
