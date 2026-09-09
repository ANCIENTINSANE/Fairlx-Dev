/** Canonical checkout path inside every Fairlx coding-session sandbox. */
export const SANDBOX_WORKSPACE = "/workspace";

export function normalizeSandboxCwd(cwd?: string): string {
  const value = (cwd || SANDBOX_WORKSPACE).trim() || SANDBOX_WORKSPACE;
  if (!value.startsWith("/") || /[;|&`$()<>]/.test(value)) return SANDBOX_WORKSPACE;
  return value.replace(/\/+$/, "") || SANDBOX_WORKSPACE;
}

/**
 * Azure executeShellCommand chdirs to workingDirectory (or the image WORKDIR) *before*
 * the process starts. If that path is missing, mkdir never runs. Always mkdir+cd in the
 * shell itself and do not send workingDirectory to Azure.
 */
export function wrapSandboxShell(command: string, cwd?: string): string {
  const dir = JSON.stringify(normalizeSandboxCwd(cwd));
  return `mkdir -p ${dir} && cd ${dir} && ${command}`;
}

export function parseGithubHttpsClone(cloneUrl: string): { owner: string; repo: string; token?: string } | null {
  try {
    const parsed = new URL(cloneUrl);
    if (!/github\.com$/i.test(parsed.hostname)) return null;
    const parts = parsed.pathname.replace(/^\//, "").replace(/\.git$/i, "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const user = decodeURIComponent(parsed.username || "");
    const password = parsed.password ? decodeURIComponent(parsed.password) : "";
    const token = user.toLowerCase() === "x-access-token" ? password : password || undefined;
    return { owner: parts[0]!, repo: parts[1]!, token: token || undefined };
  } catch {
    return null;
  }
}

/** Written after the repo lands in /workspace (git clone or tarball). Excluded from git. */
export const SANDBOX_SOURCE_MARKER = `${SANDBOX_WORKSPACE}/.fairlx-source`;
export const SANDBOX_GIT_INSTALL_LOG = "/tmp/fairlx-git-install.log";

/**
 * Public Azure `node` disks (Debian bookworm) ship curl/wget/tar/npm but no git. The egress
 * proxy (trafficInspection Full) answers 403 to plain HTTP, and Debian's apt sources use
 * http://deb.debian.org — so apt must be switched to https before `apt-get install git`.
 * This never aborts the caller: if git cannot be installed the clone falls back to a tarball.
 */
export function ensureGitInSandboxShell(): string {
  const log = SANDBOX_GIT_INSTALL_LOG;
  return [
    "if ! command -v git >/dev/null 2>&1; then",
    "if command -v apt-get >/dev/null 2>&1; then",
    `for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do [ -f "$f" ] && sed -i 's|http://|https://|g' "$f"; done;`,
    `(apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends git ca-certificates) >${log} 2>&1 || echo "git install via apt failed; see ${log}" >&2;`,
    "elif command -v apk >/dev/null 2>&1; then",
    `apk add --no-cache git >${log} 2>&1 || echo "git install via apk failed" >&2;`,
    "elif command -v dnf >/dev/null 2>&1; then",
    `dnf install -y git >${log} 2>&1 || echo "git install via dnf failed" >&2;`,
    "elif command -v microdnf >/dev/null 2>&1; then",
    `microdnf install -y git >${log} 2>&1 || echo "git install via microdnf failed" >&2;`,
    "fi;",
    "fi;",
    "command -v git >/dev/null 2>&1 && echo FAIRLX_GIT_OK || echo FAIRLX_GIT_MISSING",
  ].join(" ");
}

/**
 * Fetch the GitHub tarball for a ref without git. Uses curl, then wget, then Node's fetch
 * (Node honours NODE_EXTRA_CA_CERTS, which Azure sets for its egress proxy).
 */
export function fetchGithubTarballShell(params: {
  owner: string;
  repo: string;
  ref: string;
  token?: string;
  archive: string;
}): string {
  const url = `https://api.github.com/repos/${params.owner}/${params.repo}/tarball/${encodeURIComponent(params.ref)}`;
  const quotedUrl = JSON.stringify(url);
  const auth = params.token ? JSON.stringify(`Authorization: Bearer ${params.token}`) : "";
  const curl = `curl -fsSL -m 300${auth ? ` -H ${auth}` : ""} -H "Accept: application/vnd.github+json" -H "User-Agent: fairlx-sandbox" ${quotedUrl} -o ${params.archive}`;
  const wget = `wget -q -O ${params.archive}${auth ? ` --header=${auth}` : ""} --header="Accept: application/vnd.github+json" --header="User-Agent: fairlx-sandbox" ${quotedUrl}`;
  const nodeScript =
    'const fs=require("fs");const [u,f,t]=process.argv.slice(1);const h={Accept:"application/vnd.github+json","User-Agent":"fairlx-sandbox"};if(t)h.Authorization="Bearer "+t;fetch(u,{headers:h}).then(async r=>{if(!r.ok)throw new Error("HTTP "+r.status);fs.writeFileSync(f,Buffer.from(await r.arrayBuffer()));}).catch(e=>{console.error(String(e.message||e));process.exit(1);});';
  const node = `node -e ${JSON.stringify(nodeScript)} ${quotedUrl} ${params.archive} ${JSON.stringify(params.token || "")}`;
  return `((command -v curl >/dev/null 2>&1 && ${curl}) || (command -v wget >/dev/null 2>&1 && ${wget}) || (command -v node >/dev/null 2>&1 && ${node}))`;
}

/**
 * Put the repo in /workspace. Prefers a real git clone (needed for branch + push); if git is
 * unavailable it extracts the GitHub tarball so install/preview can still run. Clone into a
 * temp dir then copy, so /workspace can already exist (files API marker).
 */
export function cloneIntoWorkspaceShell(cloneUrl: string, branch?: string): string {
  const url = JSON.stringify(cloneUrl);
  const src = "/tmp/fairlx-src";
  const archive = "/tmp/fairlx-src.tgz";
  const branchName = branch?.trim();
  const clone = branchName
    ? `git clone --depth 1 --branch ${JSON.stringify(branchName)} ${url} ${src} || git clone --depth 1 ${url} ${src}`
    : `git clone --depth 1 ${url} ${src}`;
  const github = parseGithubHttpsClone(cloneUrl);
  const tarball = github
    ? `${fetchGithubTarballShell({ owner: github.owner, repo: github.repo, ref: branchName || "HEAD", token: github.token, archive })} && mkdir -p ${src} && tar -xzf ${archive} -C ${src} --strip-components=1 && rm -f ${archive} && echo "mode=tarball" > ${src}/.fairlx-source`
    : "false";
  const gitClone = `(command -v git >/dev/null 2>&1 && (${clone}) && echo "mode=git" > ${src}/.fairlx-source)`;
  return [
    ensureGitInSandboxShell(),
    `rm -rf ${src} ${archive}`,
    `(${gitClone} || (rm -rf ${src}; ${tarball}))`,
    `mkdir -p ${SANDBOX_WORKSPACE}`,
    `cp -a ${src}/. ${SANDBOX_WORKSPACE}/`,
    `rm -rf ${src}`,
    `echo "ref=${(branchName || "HEAD").replace(/["\\$`]/g, "")}" >> ${SANDBOX_SOURCE_MARKER}`,
    `if [ -d ${SANDBOX_WORKSPACE}/.git ]; then mkdir -p ${SANDBOX_WORKSPACE}/.git/info && printf '.fairlx\\n.fairlx-source\\n' >> ${SANDBOX_WORKSPACE}/.git/info/exclude; fi`,
    `test -f ${SANDBOX_SOURCE_MARKER}`,
    `cat ${SANDBOX_SOURCE_MARKER}`,
  ].join(" && ");
}

/** Create the fairlx/{key} branch when git is present; never fail the session over it. */
export function createSandboxBranchShell(headBranch: string): string {
  const name = JSON.stringify(headBranch);
  return `if command -v git >/dev/null 2>&1 && [ -d ${SANDBOX_WORKSPACE}/.git ]; then (git checkout -b ${name} || git checkout ${name}) && echo "branch=${headBranch.replace(/["\\$`]/g, "")}"; else echo "git unavailable in this sandbox; branch ${headBranch.replace(/["\\$`]/g, "")} not created (preview only)"; fi`;
}

/** "yes" when the repo already landed in /workspace (marker or .git). */
export function sandboxHasSourceShell(): string {
  return `( test -f ${SANDBOX_SOURCE_MARKER} || test -d ${SANDBOX_WORKSPACE}/.git ) && echo yes || echo no`;
}

export function parseSandboxSourceMode(stdout: string): "git" | "tarball" | undefined {
  const match = stdout.match(/mode=(git|tarball)/);
  return match ? (match[1] as "git" | "tarball") : undefined;
}

export function parseSandboxYes(stdout: string): boolean {
  return /^\s*yes\s*$/m.test(stdout);
}

export function isSandboxCwdError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error || "");
  return /chdir|no such file or directory|working.?director|cannot access.*workspace|config\.json/i.test(text);
}

export function isMissingGitError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error || "");
  return /git: not found|FAIRLX_GIT_MISSING|command not found:\s*git/i.test(text);
}

/** The Azure sandbox VM was deleted (portal Stop/Delete) or never became ready. Recreate; do not dump files to GitHub. */
export function isSandboxGoneError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error || "");
  if (isMissingGitError(text)) return false;
  return /GlobalSandboxNotFound|Sandbox not found|GetClusterCallContextAsync/i.test(text);
}

export function sandboxSessionFailurePresentation(error: unknown): {
  title: string;
  code: "sandbox_gone" | "coding_session_failed";
  hint: string;
} {
  if (isSandboxGoneError(error)) {
    return {
      title: "Sandbox was deleted",
      code: "sandbox_gone",
      hint: "Call coding_session_start. Fairlx will create a new sandbox. Do not github_write_file.",
    };
  }
  return {
    title: "Coding session failed",
    code: "coding_session_failed",
    hint: "Call coding_session_start again. Do not github_write_file or GitHub Pages as a workaround.",
  };
}
