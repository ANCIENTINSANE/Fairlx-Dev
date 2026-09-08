export type DiffLineKind = "context" | "add" | "del";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
};

export type DiffBlock =
  | { type: "lines"; lines: DiffLine[] }
  | { type: "gap"; id: string; lines: DiffLine[] };

export function parseUnifiedPatch(patch?: string): DiffLine[] {
  if (!patch) return [];
  const out: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  const source = patch.replace(/\r\n/g, "\n").replace(/\n$/, "");
  for (const raw of source.split("\n")) {
    if (
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("new file") ||
      raw.startsWith("deleted file") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ")
    ) {
      continue;
    }
    const hunk = raw.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), newLine });
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldLine });
      oldLine += 1;
      continue;
    }
    const text = raw.startsWith(" ") ? raw.slice(1) : raw;
    out.push({ kind: "context", text, oldLine, newLine });
    oldLine += 1;
    newLine += 1;
  }
  return out;
}

export function collapseUnmodified(lines: DiffLine[]): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "context") {
      const run: DiffLine[] = [];
      while (i < lines.length && lines[i]!.kind === "context") {
        run.push(lines[i]!);
        i += 1;
      }
      blocks.push({ type: "gap", id: `gap-${blocks.length}`, lines: run });
      continue;
    }
    const run: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind !== "context") {
      run.push(lines[i]!);
      i += 1;
    }
    if (run.length) blocks.push({ type: "lines", lines: run });
  }
  return blocks;
}

export function fileExtBadge(filename: string): { label: string; className: string } {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (ext === "ts" || ext === "tsx" || ext === "mts" || ext === "cts") {
    return { label: "TS", className: "bg-sky-600 text-white" };
  }
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") {
    return { label: "JS", className: "bg-amber-400 text-zinc-900" };
  }
  if (ext === "json") return { label: "{}", className: "bg-zinc-500 text-white" };
  if (ext === "md" || ext === "mdx") return { label: "MD", className: "bg-zinc-600 text-white" };
  if (ext === "css" || ext === "scss") return { label: "CSS", className: "bg-fuchsia-600 text-white" };
  if (ext === "html") return { label: "HTML", className: "bg-orange-600 text-white" };
  if (ext === "py") return { label: "PY", className: "bg-blue-700 text-white" };
  if (ext === "go") return { label: "GO", className: "bg-cyan-700 text-white" };
  if (ext === "rs") return { label: "RS", className: "bg-orange-700 text-white" };
  const label = ext.slice(0, 3).toUpperCase() || "FILE";
  return { label, className: "bg-zinc-600 text-white" };
}

export function isNewFileStatus(status?: string): boolean {
  const value = (status || "").toLowerCase();
  return value === "added" || value === "new" || value === "created";
}
