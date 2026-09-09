#!/usr/bin/env node

/**
 * Push .env.local keys to GitHub Actions secrets/variables.
 *
 * Classification comes from .github/workflows/deploy.yml
 * (${{ secrets.NAME }} vs ${{ vars.NAME }}). Keys used only for SSH
 * (AZURE_SSH_HOST, AZURE_SSH_PRIVATE_KEY) default to secrets.
 *
 * Usage:
 *   node scripts/ci/push_env.js --all [--repo=owner/repo]
 *   node scripts/ci/push_env.js [--repo=owner/repo] KEY_1 KEY_2
 */

const fs = require("fs");
const { spawnSync } = require("child_process");

const DEPLOY_YML_PATH = ".github/workflows/deploy.yml";
const ENV_LOCAL_PATH = ".env.local";

function parseDotenv(text) {
  const result = new Map();
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = raw.indexOf("=");
    if (eq <= 0) continue;

    const key = raw.slice(0, eq).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;

    let val = raw.slice(eq + 1);

    if (val.startsWith('"')) {
      if (val.length >= 2 && val.endsWith('"') && !val.slice(0, -1).includes("\n")) {
        result.set(key, unescapeDoubleQuoted(val.slice(1, -1)));
        continue;
      }

      let acc = val.slice(1);
      while (i + 1 < lines.length) {
        i += 1;
        const line = lines[i];
        if (line.endsWith('"') && !line.endsWith('\\"')) {
          acc += "\n" + line.slice(0, -1);
          break;
        }
        acc += "\n" + line;
      }
      result.set(key, unescapeDoubleQuoted(acc));
      continue;
    }

    if (val.startsWith("'")) {
      if (val.length >= 2 && val.endsWith("'")) {
        result.set(key, val.slice(1, -1));
        continue;
      }
      let acc = val.slice(1);
      while (i + 1 < lines.length) {
        i += 1;
        const line = lines[i];
        if (line.endsWith("'")) {
          acc += "\n" + line.slice(0, -1);
          break;
        }
        acc += "\n" + line;
      }
      result.set(key, acc);
      continue;
    }

    result.set(key, val);
  }

  return result;
}

function unescapeDoubleQuoted(value) {
  return value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function typeMapFromDeploy(deployYml) {
  const typeMap = new Map();
  for (const match of deployYml.matchAll(/secrets\.([A-Z0-9_]+)/g)) {
    typeMap.set(match[1], "secret");
  }
  for (const match of deployYml.matchAll(/vars\.([A-Z0-9_]+)/g)) {
    if (!typeMap.has(match[1])) typeMap.set(match[1], "variable");
  }
  typeMap.set("AZURE_SSH_HOST", "secret");
  typeMap.set("AZURE_HOST", "secret");
  typeMap.set("AZURE_SSH_PRIVATE_KEY", "secret");
  return typeMap;
}

function classify(key, typeMap) {
  if (typeMap.has(key)) return typeMap.get(key);
  if (/SECRET|TOKEN|PASSWORD|PRIVATE|_KEY$/.test(key) && !key.startsWith("NEXT_PUBLIC_")) {
    return "secret";
  }
  return "variable";
}

function extraAliases(key, value) {
  const extras = [];
  if (key === "AZURE_SSH_HOST") extras.push(["AZURE_HOST", value]);
  if (key === "NEXT_PUBLIC_ORG_TRIAL_CREDIT_USD") extras.push(["ORG_TRIAL_CREDIT_USD", value]);
  if (key === "NEXT_PUBLIC_PERSONAL_TRIAL_CREDIT_USD") extras.push(["PERSONAL_TRIAL_CREDIT_USD", value]);
  // GitHub rejects secret names that start with GITHUB_.
  if (key === "GITHUB_CLIENT_ID") extras.push(["GH_CLIENT_ID", value]);
  if (key === "GITHUB_CLIENT_SECRET") extras.push(["GH_CLIENT_SECRET", value]);
  return extras;
}

function githubTargetKey(key, type) {
  if (key.startsWith("GITHUB_")) {
    return null;
  }
  return key;
}

function ghSet(kind, key, value, repo) {
  const args =
    kind === "secret"
      ? ["secret", "set", key, "--repo", repo]
      : ["variable", "set", key, "--repo", repo];

  const result = spawnSync("gh", args, {
    input: value,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    throw new Error(err || `gh exited ${result.status}`);
  }
}

if (!fs.existsSync(DEPLOY_YML_PATH)) {
  console.error(`Error: ${DEPLOY_YML_PATH} not found.`);
  process.exit(1);
}
if (!fs.existsSync(ENV_LOCAL_PATH)) {
  console.error(`Error: ${ENV_LOCAL_PATH} not found.`);
  process.exit(1);
}

const deployYml = fs.readFileSync(DEPLOY_YML_PATH, "utf8");
const envLocal = fs.readFileSync(ENV_LOCAL_PATH, "utf8");
const typeMap = typeMapFromDeploy(deployYml);
const valueMap = parseDotenv(envLocal);

const args = process.argv.slice(2);
let targetRepo = "";
let pushAll = false;
const keysToPush = [];

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--repo=")) {
    targetRepo = args[i].split("=").slice(1).join("=");
  } else if (args[i] === "--repo" && i + 1 < args.length) {
    targetRepo = args[++i];
  } else if (args[i] === "--all") {
    pushAll = true;
  } else {
    keysToPush.push(args[i]);
  }
}

if (!targetRepo) {
  const repoResult = spawnSync(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
    { encoding: "utf8" }
  );
  targetRepo = (repoResult.stdout || "").trim();
}

if (!targetRepo) {
  console.error("Error: Could not detect GitHub repository. Pass --repo=owner/repo");
  process.exit(1);
}

const requested = pushAll ? [...valueMap.keys()] : keysToPush;
if (requested.length === 0) {
  console.log("Usage: node scripts/ci/push_env.js --all [--repo=owner/repo]");
  console.log("   or: node scripts/ci/push_env.js [--repo=owner/repo] KEY_1 KEY_2");
  process.exit(0);
}

const jobs = [];
for (const key of requested) {
  const value = valueMap.get(key);
  if (value === undefined) {
    console.error(`Skip: "${key}" not found in ${ENV_LOCAL_PATH}`);
    continue;
  }
  if (value.trim() === "") {
    console.log(`Skip empty: ${key}`);
    continue;
  }
  const type = classify(key, typeMap);
  const target = githubTargetKey(key, type);
  if (target) {
    jobs.push({ key: target, value, type });
  } else {
    console.log(`Skip reserved GitHub name: ${key} (mapped via alias)`);
  }
  for (const [alias, aliasValue] of extraAliases(key, value)) {
    jobs.push({ key: alias, value: aliasValue, type: classify(alias, typeMap) });
  }
}

console.log(`Syncing ${jobs.length} keys to ${targetRepo} (values not printed)`);

let ok = 0;
let failed = 0;
for (const job of jobs) {
  const label = job.type === "secret" ? "secret" : "variable";
  try {
    ghSet(job.type, job.key, job.value, targetRepo);
    console.log(`OK ${label}: ${job.key}`);
    ok += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${label}: ${job.key} (${error.message.split("\n")[0]})`);
  }
}

console.log(`Done. ${ok} updated, ${failed} failed.`);
if (failed > 0) process.exit(1);
