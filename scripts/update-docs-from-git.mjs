#!/usr/bin/env node
/**
 * Regenerates changelog.md from git history.
 * Run on every commit (--commit) and every push (--push).
 * README.md is product documentation and is not rewritten here.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHANGELOG = join(ROOT, "changelog.md");
const SKIP_SUBJECT = /^(docs: refresh (README and )?changelog\b)/;

function git(args) {
  return execSync(`git ${args}`, {
    encoding: "utf8",
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function escapeTable(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function commits(limit = 80) {
  let raw = "";
  try {
    raw = git(`log -${limit} --pretty=format:%h%x09%s%x09%ad%x09%an --date=short`);
  } catch {
    return [];
  }
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => {
      const [hash, subject, date, author] = line.split("\t");
      return { hash, subject, date, author };
    })
    .filter((row) => row.hash && row.subject && !SKIP_SUBJECT.test(row.subject));
}

function stagedFiles() {
  let raw = "";
  try {
    raw = git("diff --cached --name-only");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((file) => file && file !== "changelog.md");
}

function buildChangelog(includeStaged) {
  const rows = commits(100);
  const staged = includeStaged ? stagedFiles() : [];
  const generatedAt = new Date().toISOString();
  const lines = [
    "# Changelog",
    "",
    "This file is generated on every `git commit` and `git push`. Do not edit it by hand.",
    "",
    "Older session notes live in [docs/changelog-history.md](docs/changelog-history.md).",
    "",
  ];
  if (staged.length) {
    lines.push("## Unreleased", "", "Files in this commit:", "");
    for (const file of staged) lines.push(`- \`${file}\``);
    lines.push("");
  }
  lines.push("## Recent commits", "");
  lines.push("| Date | Commit | Message | Author |");
  lines.push("|------|--------|---------|--------|");
  for (const row of rows) {
    lines.push(
      `| ${row.date} | \`${row.hash}\` | ${escapeTable(row.subject)} | ${escapeTable(row.author)} |`,
    );
  }
  if (!rows.length) {
    lines.push("| — | — | No commits yet | — |");
  }
  lines.push("", `Last generated: ${generatedAt}`, "");
  return `${lines.join("\n")}`;
}

function main() {
  const includeStaged = process.argv.includes("--commit");
  writeFileSync(CHANGELOG, buildChangelog(includeStaged), "utf8");
}

main();
