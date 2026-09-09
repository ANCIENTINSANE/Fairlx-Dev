export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | "pip" | "poetry" | "go" | "unknown";

export type DetectedStartCommand = {
  packageManager: PackageManager;
  installCommand: string;
  startCommand: string;
  runtime: "node" | "python" | "go" | "unknown";
  port: number;
  source: "override" | "package.json" | "python" | "go" | "fallback";
  /** Repo-relative directory when the app lives under packages/ or apps/ instead of the repo root. */
  appDir?: string;
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

/** Port a package.json script pins itself (e.g. `vite --port 5173`, `next dev -p 4000`). */
export function scriptPinnedPort(script: string): number | undefined {
  const match = script.match(/(?:^|\s)(?:-p|--port|--listen)(?:\s+|=)(\d{2,5})\b/);
  if (!match) return undefined;
  const port = Number(match[1]);
  return Number.isFinite(port) && port > 0 ? port : undefined;
}

/**
 * Flags to forward through the package-manager runner (`npm run dev -- <flags>`) so the
 * framework binds 0.0.0.0 on the expected port. PORT/HOST env alone is ignored by Vite.
 */
export function passthroughListenFlags(script: string, port: number): string {
  const body = script.trim();
  const hasPort = scriptPinnedPort(body) !== undefined;
  if (/next\s+dev/.test(body)) {
    const host = /\s-H\s|--hostname/.test(body) ? "" : " -H 0.0.0.0";
    return `${hasPort ? "" : ` -p ${port}`}${host}`.trim();
  }
  if (/\bvite\b|\bastro\s+dev\b|\bnuxt\s+dev\b|\bnuxi\s+dev\b|\bremix\s+vite:dev\b|\bwebpack\s+serve\b|\bwebpack-dev-server\b/.test(body)) {
    const host = /--host/.test(body) ? "" : " --host 0.0.0.0";
    return `${hasPort ? "" : ` --port ${port}`}${host}`.trim();
  }
  if (/\breact-scripts\s+start\b|\bng\s+serve\b/.test(body)) {
    if (/\bng\s+serve\b/.test(body)) return `${hasPort ? "" : `--port ${port} `}--host 0.0.0.0`.trim();
    return "";
  }
  return "";
}

function nodeStartFromScripts(manager: PackageManager, scripts: Record<string, string>, port: number): {
  command: string;
  port: number;
} | undefined {
  const runner = scripts.dev ? "dev" : scripts.start ? "start" : scripts.preview ? "preview" : scripts.serve ? "serve" : undefined;
  if (!runner) return undefined;
  const body = scripts[runner] || "";
  const pinned = scriptPinnedPort(body);
  const effectivePort = pinned ?? port;
  const flags = passthroughListenFlags(body, effectivePort);
  const base = nodeRunScript(manager, runner);
  const command = flags ? `${base} -- ${flags}` : base;
  return { command: `HOST=0.0.0.0 PORT=${effectivePort} ${command}`, port: effectivePort };
}

/** Env prefix so Vite (>=5.4.12/6.0.9) and Next accept requests arriving via the public preview host. */
export function previewHostEnvPrefix(previewHost?: string): string {
  const host = (previewHost || "").trim().replace(/^https?:\/\//, "").replace(/[/:].*$/, "");
  if (!host || /[^A-Za-z0-9.-]/.test(host)) return "";
  return `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=${host} DANGEROUSLY_DISABLE_HOST_CHECK=true `;
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

export function rankNestedPackageJsonPaths(paths: string[]): string[] {
  const nested = paths
    .map((path) => path.replace(/\\/g, "/").trim())
    .filter((path) => {
      if (!path || path.includes("/node_modules/")) return false;
      const rel = path.replace(/^\/workspace\//, "");
      return rel !== "package.json" && /package\.json$/i.test(path);
    });
  const score = (path: string) => {
    if (/\/(packages|apps)\/(landing-page|web|frontend|app|ui|www)\//i.test(path)) return 0;
    if (/\/(packages|apps)\//i.test(path)) return 1;
    return 2;
  };
  return [...new Set(nested)].sort((a, b) => score(a) - score(b) || a.length - b.length);
}

export function appDirFromWorkspacePackageJson(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/");
  const rel = normalized.replace(/^\/workspace\//, "");
  if (!rel.endsWith("/package.json") || rel === "package.json") return undefined;
  return rel.slice(0, -"/package.json".length);
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
    appDir?: string;
  };
  exposePort?: number;
  prepareScript?: string;
  startCommand?: string;
  previewHost?: string;
}): DetectedStartCommand {
  const port = Number.isFinite(input.exposePort) && (input.exposePort || 0) > 0 ? Number(input.exposePort) : DEFAULT_PORT;
  const hostEnv = previewHostEnvPrefix(input.previewHost);
  const files = input.files ?? {};
  const appDir =
    typeof files.appDir === "string" && files.appDir.trim()
      ? files.appDir.replace(/^\/+|\/+$/g, "")
      : undefined;
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
    const overridePort = scriptPinnedPort(input.startCommand) ?? port;
    return {
      packageManager: manager,
      installCommand: install,
      startCommand: `${hostEnv}${injectListenPort(input.startCommand.trim(), overridePort)}`,
      runtime: manager === "go" ? "go" : manager === "pip" || manager === "poetry" ? "python" : "node",
      port: overridePort,
      source: "override",
      appDir,
    };
  }

  const scripts = parsePackageJsonScripts(files["package.json"]);
  if (Object.keys(scripts).length) {
    const resolvedManager = manager === "unknown" ? "npm" : manager;
    const start = nodeStartFromScripts(resolvedManager, scripts, port) ?? {
      command: injectListenPort(nodeRunScript(resolvedManager, "dev"), port),
      port,
    };
    return {
      packageManager: resolvedManager,
      installCommand: input.prepareScript?.trim() || nodeInstallCommand(resolvedManager),
      startCommand: `${hostEnv}${start.command}`,
      runtime: "node",
      port: start.port,
      source: "package.json",
      appDir,
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
      appDir,
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
      appDir,
    };
  }

  return {
    packageManager: "unknown",
    installCommand: input.prepareScript?.trim() || "npm install",
    startCommand: `${hostEnv}${injectListenPort("npm run dev", port)}`,
    runtime: "unknown",
    port,
    source: "fallback",
    appDir,
  };
}

/**
 * Start the dev server detached from the exec call. No `exec` prefix: start commands begin
 * with `VAR=value` assignments, and `exec VAR=value cmd` would try to run a program named
 * `VAR=value`.
 */
export function backgroundStartShell(startCommand: string, logPath = "/tmp/fairlx-dev.log"): string {
  const wrapped = JSON.stringify(startCommand);
  return `nohup sh -c ${wrapped} > ${logPath} 2>&1 < /dev/null & echo $!`;
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
