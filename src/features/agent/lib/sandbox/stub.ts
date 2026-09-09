import type { SandboxCreateParams, SandboxDriver, SandboxExecResult, SandboxInfo } from "./types";
import { redactSecrets } from "./types";

type StubBox = {
  id: string;
  files: Map<string, string>;
  previewUrl?: string;
  log: string[];
};

const boxes = new Map<string, StubBox>();

function box(id: string): StubBox {
  const found = boxes.get(id);
  if (!found) throw new Error(`Stub sandbox ${id} not found`);
  return found;
}

/** In-memory driver for tests and when Azure is not provisioned. Never runs a host shell. */
export class StubSandboxDriver implements SandboxDriver {
  readonly kind = "stub" as const;

  async create(params?: SandboxCreateParams): Promise<SandboxInfo> {
    const id = `stub-${crypto.randomUUID()}`;
    boxes.set(id, { id, files: new Map(), log: [`created ${JSON.stringify(params?.labels ?? {})}`] });
    return { id, driver: "stub" };
  }

  async exists(sandboxId: string): Promise<boolean> {
    return boxes.has(sandboxId);
  }

  async exec(sandboxId: string, command: string, cwd?: string): Promise<SandboxExecResult> {
    const sandbox = box(sandboxId);
    const safe = redactSecrets(command);
    sandbox.log.push(`${cwd || "."}$ ${safe}`);
    const lower = command.toLowerCase();
    if (/\bgit clone\b/.test(lower)) {
      sandbox.files.set("/workspace/.git/HEAD", "ref: refs/heads/main");
      return { stdout: redactSecrets("Cloned into /workspace (stub)."), stderr: "", exitCode: 0 };
    }
    if (/\btest -d\b/.test(lower) && /\/workspace\/\.git/.test(lower)) {
      return {
        stdout: sandbox.files.has("/workspace/.git/HEAD") ? "yes" : "no",
        stderr: "",
        exitCode: 0,
      };
    }
    if (/\bgit checkout -b\b/.test(lower) || /\bgit switch -c\b/.test(lower)) {
      return { stdout: "Switched to a new branch (stub).", stderr: "", exitCode: 0 };
    }
    if (/\bgit push\b/.test(lower)) {
      return { stdout: "Pushed (stub). Connect Azure sandboxes for a real remote.", stderr: "", exitCode: 0 };
    }
    if (/\btest -f\b/.test(lower)) {
      return { stdout: "no", stderr: "", exitCode: 0 };
    }
    if (/\b(npm (ci|install)|pnpm install|yarn install|bun install|pip install|poetry install|go mod)\b/.test(lower)) {
      return { stdout: "Install recorded in stub sandbox (not executed on host).", stderr: "", exitCode: 0 };
    }
    if (/\bnohup\b|\bfairlx_health_ok\b|\bfairlx_health_fail\b/.test(lower)) {
      return { stdout: "FAIRLX_HEALTH_FAIL", stderr: "Stub driver never starts a live server.", exitCode: 1 };
    }
    if (/\bnpm (test|run)|pnpm test|vitest|pytest\b/.test(lower)) {
      return { stdout: "Tests recorded in stub sandbox (not executed on host).", stderr: "", exitCode: 0 };
    }
    return {
      stdout: `Recorded (not executed on host): ${safe}`,
      stderr: "",
      exitCode: 0,
    };
  }

  async writeFile(sandboxId: string, path: string, content: string): Promise<void> {
    box(sandboxId).files.set(path, content);
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    const content = box(sandboxId).files.get(path);
    if (content == null) throw new Error(`File not found: ${path}`);
    return content;
  }

  async exposePort(sandboxId: string, port: number): Promise<string> {
    const url = `https://preview.stub.fairlx.local/${sandboxId}/${port}`;
    box(sandboxId).previewUrl = url;
    return url;
  }

  async suspend(sandboxId: string): Promise<void> {
    box(sandboxId).log.push("suspended");
  }

  async destroy(sandboxId: string): Promise<void> {
    boxes.delete(sandboxId);
  }
}

export function resetStubSandboxes(): void {
  boxes.clear();
}
