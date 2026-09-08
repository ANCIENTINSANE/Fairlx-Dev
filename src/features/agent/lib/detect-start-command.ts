export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | "pip" | "poetry" | "go" | "unknown";

export type DetectedStartCommand = {
  packageManager: PackageManager;
  installCommand: string;
  startCommand: string;
  runtime: "node" | "python" | "go" | "unknown";
  port: number;
  source: "override" | "package.json" | "python" | "go" | "fallback";
};

const DEFAULT_PORT = 3000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parsePackageJsonScripts(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = asRecord(JSON.parse(raw));
    const scripts = asRecord(parsed?.scripts);
    if (!scripts) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(scripts)) {
      if (typeof value === "string" && value.trim()) out[key] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function detectPackageManager(files: {
  "pnpm-lock.yaml"?: boolean;
  "yarn.lock"?: boolean;
  "bun.lockb"?: boolean;
  "bun.lock"?: boolean;
  "package-lock.json"?: boolean;
  "package.json"?: boolean;
  "poetry.lock"?: boolean;
  "pyproject.toml"?: boolean;
  "requirements.txt"?: boolean;
  "go.mod"?: boolean;
}): PackageManager {
  if (files["pnpm-lock.yaml"]) return "pnpm";
  if (files["yarn.lock"]) return "yarn";
  if (files["bun.lockb"] || files["bun.lock"]) return "bun";
  if (files["package-lock.json"] || files["package.json"]) return "npm";
  if (files["poetry.lock"]) return "poetry";
  if (files["pyproject.toml"] || files["requirements.txt"]) return "pip";
  if (files["go.mod"]) return "go";
  return "unknown";
}

export function injectListenPort(command: string, port: number): string {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  const hasPortFlag = /(?:^|\s)(-p|--port|--listen)(\s|=|$)/.test(trimmed) || new RegExp(`:${port}\\b`).test(trimmed);
  if (hasPortFlag) {
    if (/next\s+dev/.test(trimmed) && !/\s-H\s/.test(trimmed) && !/--hostname/.test(trimmed)) {
      return `${trimmed} -H 0.0.0.0`;
    }
    if (/\bvite\b/.test(trimmed) && !/--host/.test(trimmed)) {
      return `${trimmed} --host 0.0.0.0`;
    }
    return trimmed;
  }
  if (/next\s+dev/.test(trimmed)) return `${trimmed} -p ${port} -H 0.0.0.0`;
  if (/\bvite\b/.test(trimmed)) return `${trimmed} --host 0.0.0.0 --port ${port}`;
  if (/\b(nuxt|astro|remix)\b/.test(trimmed)) return `${trimmed} --port ${port}`;
  return `HOST=0.0.0.0 PORT=${port} ${trimmed}`;
}

function nodeInstallCommand(manager: PackageManager): string {
  if (manager === "pnpm") return "pnpm install --frozen-lockfile || pnpm install";
  if (manager === "yarn") return "yarn install --frozen-lockfile || yarn install";
  if (manager === "bun") return "bun install";
  return "npm ci || npm install";
}

function nodeRunScript(manager: PackageManager, script: "dev" | "start" | "preview" | "serve"): string {
  if (manager === "pnpm") return `pnpm ${script}`;
  if (manager === "yarn") return `yarn ${script}`;
  if (manager === "bun") return `bun run ${script}`;
  return `npm run ${script}`;
}

function nodeStartFromScripts(manager: PackageManager, scripts: Record<string, string>, port: number): string | undefined {
  const runner = scripts.dev ? "dev" : scripts.start ? "start" : scripts.preview ? "preview" : scripts.serve ? "serve" : undefined;
  if (!runner) return undefined;
  return injectListenPort(nodeRunScript(manager, runner), port);
}

function pythonStart(files: { "manage.py"?: boolean; requirements?: string; pyproject?: string }, port: number): string {
  const blob = `${files.requirements || ""}\n${files.pyproject || ""}`.toLowerCase();
  if (files["manage.py"]) return `python manage.py runserver 0.0.0.0:${port}`;
  if (/\b(fastapi|uvicorn)\b/.test(blob)) {
    return `python -m uvicorn app.main:app --host 0.0.0.0 --port ${port}`;
  }
  if (/\bflask\b/.test(blob)) return `flask run --host 0.0.0.0 --port ${port}`;
  return `python -m http.server ${port} --bind 0.0.0.0`;
}

export function detectStartCommand(input: {
  files?: {
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
  };
  exposePort?: number;
  prepareScript?: string;
  startCommand?: string;
}): DetectedStartCommand {
  const port = Number.isFinite(input.exposePort) && (input.exposePort || 0) > 0 ? Number(input.exposePort) : DEFAULT_PORT;
  const files = input.files ?? {};
  const manager = detectPackageManager({
    "pnpm-lock.yaml": Boolean(files["pnpm-lock.yaml"]),
    "yarn.lock": Boolean(files["yarn.lock"]),
    "bun.lockb": Boolean(files["bun.lockb"]),
    "bun.lock": Boolean(files["bun.lock"]),
    "package-lock.json": Boolean(files["package-lock.json"]),
    "package.json": Boolean(files["package.json"]),
    "poetry.lock": Boolean(files["poetry.lock"]),
    "pyproject.toml": Boolean(files["pyproject.toml"]),
    "requirements.txt": Boolean(files["requirements.txt"]),
    "go.mod": Boolean(files["go.mod"]),
  });

  if (input.startCommand?.trim()) {
    const install = input.prepareScript?.trim()
      ? input.prepareScript.trim()
      : manager === "go"
        ? "go mod download"
        : manager === "pip" || manager === "poetry"
          ? manager === "poetry"
            ? "poetry install"
            : "pip install -r requirements.txt || pip install -e ."
          : nodeInstallCommand(manager === "unknown" ? "npm" : manager);
    return {
      packageManager: manager,
      installCommand: install,
      startCommand: injectListenPort(input.startCommand.trim(), port),
      runtime: manager === "go" ? "go" : manager === "pip" || manager === "poetry" ? "python" : "node",
      port,
      source: "override",
    };
  }

  const scripts = parsePackageJsonScripts(files["package.json"]);
  if (Object.keys(scripts).length) {
    const resolvedManager = manager === "unknown" ? "npm" : manager;
    const start = nodeStartFromScripts(resolvedManager, scripts, port) || injectListenPort(nodeRunScript(resolvedManager, "dev"), port);
    return {
      packageManager: resolvedManager,
      installCommand: input.prepareScript?.trim() || nodeInstallCommand(resolvedManager),
      startCommand: start,
      runtime: "node",
      port,
      source: "package.json",
    };
  }

  if (files["go.mod"]) {
    return {
      packageManager: "go",
      installCommand: input.prepareScript?.trim() || "go mod download",
      startCommand: `PORT=${port} go run .`,
      runtime: "go",
      port,
      source: "go",
    };
  }

  if (files["requirements.txt"] || files["pyproject.toml"] || files["manage.py"] || manager === "pip" || manager === "poetry") {
    return {
      packageManager: manager === "poetry" ? "poetry" : "pip",
      installCommand:
        input.prepareScript?.trim() ||
        (manager === "poetry" ? "poetry install" : "pip install -r requirements.txt || pip install -e ."),
      startCommand: pythonStart(
        {
          "manage.py": Boolean(files["manage.py"]),
          requirements: files["requirements.txt"],
          pyproject: files["pyproject.toml"],
        },
        port,
      ),
      runtime: "python",
      port,
      source: "python",
    };
  }

  return {
    packageManager: "unknown",
    installCommand: input.prepareScript?.trim() || "npm install",
    startCommand: injectListenPort("npm run dev", port),
    runtime: "unknown",
    port,
    source: "fallback",
  };
}

export function backgroundStartShell(startCommand: string, logPath = "/tmp/fairlx-dev.log"): string {
  const wrapped = JSON.stringify(`exec ${startCommand}`);
  return `nohup sh -c ${wrapped} > ${logPath} 2>&1 & echo $!`;
}

export function healthCheckShell(port: number, attempts = 16, sleepSeconds = 2): string {
  return [
    `ok=0`,
    `i=0`,
    `while [ $i -lt ${attempts} ]; do`,
    `  i=$((i+1))`,
    `  if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:${port} || curl -sf -o /dev/null --max-time 2 http://127.0.0.1:${port}/health || wget -q -O /dev/null --timeout=2 http://127.0.0.1:${port}; then`,
    `    echo FAIRLX_HEALTH_OK`,
    `    ok=1`,
    `    break`,
    `  fi`,
    `  sleep ${sleepSeconds}`,
    `done`,
    `if [ $ok -ne 1 ]; then echo FAIRLX_HEALTH_FAIL; tail -n 40 /tmp/fairlx-dev.log 2>/dev/null || true; fi`,
  ].join("\n");
}
