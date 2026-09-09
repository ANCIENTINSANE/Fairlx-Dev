"use client";

import type { ComponentType, HTMLAttributes } from "react";
import {
  ArrowUpRight,
  ExternalLink,
  Folder,
  GitBranch,
  Globe,
  Key,
  Terminal,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { getFileIconMeta } from "./file-icon";

export type InlineCodeType =
  | "url"
  | "branch"
  | "command"
  | "file"
  | "dir"
  | "env"
  | "localhost"
  | "constant"
  | "number"
  | "code";

export type InlineCodeClassification = {
  type: InlineCodeType;
  icon?: ComponentType<{ className?: string }>;
  tone: string;
  href?: string;
  label?: string;
};

export function classifyInlineCode(text: string): InlineCodeClassification {
  const trimmed = text.trim();

  // 1. Web URL (e.g. https://... or http://...)
  if (/^https?:\/\//i.test(trimmed)) {
    return {
      type: "url",
      href: trimmed,
      icon: ExternalLink,
      tone: "text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/25 hover:bg-sky-500/20",
      label: "Link",
    };
  }

  // 2. Git Branch (e.g. main, master, dev, feature/..., fix/...)
  const isBranch =
    ["main", "master", "develop", "dev", "staging", "prod", "production", "head"].includes(trimmed.toLowerCase()) ||
    /^(feature|feat|fix|hotfix|release|chore|bug|refactor|test|docs)\/[\w.-]+/i.test(trimmed);
  if (isBranch) {
    return {
      type: "branch",
      icon: GitBranch,
      tone: "text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/25",
      label: "Branch",
    };
  }

  // 3. CLI / Shell Command (e.g. npm install, git push, cd ..., pnpm dev)
  const isCommand =
    /^(npm|npx|pnpm|yarn|bun|git|cd|docker|curl|cat|ls|mkdir|rm|cp|mv|chmod|chown|export|sudo|node|tsx|python|pip|cargo|go|brew|echo|kill|code)\s+/i.test(trimmed) ||
    /^(npm|pnpm|yarn|bun)\s*(install|add|run|build|dev|start|test)/i.test(trimmed) ||
    /^(git)\s*(status|commit|push|pull|checkout|switch|branch|add|merge|rebase|clone|diff|log)/i.test(trimmed);
  if (isCommand) {
    return {
      type: "command",
      icon: Terminal,
      tone: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
      label: "Command",
    };
  }

  // 4. File Path or Filename with extension (e.g. .github/workflows/deploy-pages.yml, App.tsx, index.html)
  const hasExt = /\.[a-z0-9]{1,10}$/i.test(trimmed);
  const isSpecialFile = /^(dockerfile|makefile|vagrantfile|\.env(\.[\w.-]+)?|\.gitignore|\.dockerignore|\.gitattributes)$/i.test(trimmed.split("/").pop() || "");
  if ((hasExt && !trimmed.includes(" ")) || isSpecialFile) {
    const meta = getFileIconMeta(trimmed);
    return {
      type: "file",
      icon: meta.icon,
      tone: cn(meta.tone, "border-current/25"),
      label: meta.label,
    };
  }

  // 5. Directory / Folder path (e.g. packages/landing-page, src/components, /workspace)
  const isDir =
    (trimmed.includes("/") || trimmed.endsWith("/")) &&
    !trimmed.includes(" ") &&
    !hasExt;
  if (isDir) {
    return {
      type: "dir",
      icon: Folder,
      tone: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25",
      label: "Directory",
    };
  }

  // 6. Environment variable / Config key (e.g. NODE_ENV, PORT, NEXT_PUBLIC_*)
  const isEnv = /^[A-Z][A-Z0-9_]{2,}(\s*=\s*.+)?$/.test(trimmed);
  if (isEnv) {
    return {
      type: "env",
      icon: Key,
      tone: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25",
      label: "Environment variable",
    };
  }

  // 7. Localhost / Port (e.g. localhost:3000, :3000)
  const isLocalhost = /^(https?:\/\/)?localhost(:\d+)?(\/.*)?$/i.test(trimmed) || /^:\d{2,5}$/.test(trimmed);
  if (isLocalhost) {
    return {
      type: "localhost",
      icon: Globe,
      tone: "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/25 hover:bg-indigo-500/20",
      href: trimmed.startsWith("http") ? trimmed : `http://${trimmed.startsWith(":") ? `localhost${trimmed}` : trimmed}`,
      label: "Localhost",
    };
  }

  // 8. Booleans / constants (true, false, null, undefined)
  if (/^(true|false|null|undefined)$/.test(trimmed)) {
    return {
      type: "constant",
      tone: "text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/25",
      label: "Constant",
    };
  }

  // 9. Numeric values
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return {
      type: "number",
      tone: "text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/25",
      label: "Number",
    };
  }

  // 10. General code symbol / identifier
  return {
    type: "code",
    tone: "text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/25",
    label: "Code",
  };
}

export function InlineCode({
  text,
  href,
  className,
  ...props
}: {
  text: string;
  href?: string;
  className?: string;
} & HTMLAttributes<HTMLElement>) {
  const classification = classifyInlineCode(text);
  const Icon = classification.icon;
  const targetHref = href || classification.href;

  if (targetHref) {
    return (
      <a
        href={targetHref}
        target="_blank"
        rel="noopener noreferrer"
        title={classification.label}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-mono font-medium border transition-colors hover:underline",
          classification.tone,
          className,
        )}
      >
        {Icon ? <Icon className="size-3 shrink-0" /> : null}
        <span>{text}</span>
        <ArrowUpRight className="size-3 shrink-0 opacity-70" />
      </a>
    );
  }

  return (
    <code
      title={classification.label}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-mono font-medium border",
        classification.tone,
        className,
      )}
      {...props}
    >
      {Icon ? <Icon className="size-3 shrink-0" /> : null}
      <span>{text}</span>
    </code>
  );
}
