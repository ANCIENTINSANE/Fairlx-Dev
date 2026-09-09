"use client";

import type { ComponentType } from "react";
import {
  Database,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileKey,
  FileText,
  FileVideo,
  Terminal,
} from "lucide-react";
import {
  SiAstro,
  SiBun,
  SiCplusplus,
  SiCss3,
  SiDocker,
  SiEslint,
  SiGit,
  SiGo,
  SiGraphql,
  SiHtml5,
  SiJavascript,
  SiJest,
  SiKotlin,
  SiMarkdown,
  SiNextdotjs,
  SiNpm,
  SiPhp,
  SiPnpm,
  SiPostcss,
  SiPrettier,
  SiPrisma,
  SiPython,
  SiReact,
  SiRuby,
  SiRust,
  SiSass,
  SiSvelte,
  SiSvg,
  SiSwift,
  SiTailwindcss,
  SiTypescript,
  SiVite,
  SiVitest,
  SiVuedotjs,
  SiYaml,
  SiYarn,
} from "react-icons/si";
import { VscJson } from "react-icons/vsc";

import { cn } from "@/lib/utils";

export type FileIconMeta = {
  icon: ComponentType<{ className?: string }>;
  tone: string;
  label: string;
};

export function getFileIconMeta(filename: string): FileIconMeta {
  const normalized = filename.replace(/\\/g, "/");
  const base = (normalized.split("/").pop() || normalized).toLowerCase();

  // 1. Exact or pattern-matched special filenames
  if (base === "package.json" || base === "package-lock.json") {
    return {
      icon: SiNpm,
      tone: "text-red-600 dark:text-red-400 bg-red-500/10",
      label: "npm",
    };
  }
  if (base === "pnpm-lock.yaml") {
    return {
      icon: SiPnpm,
      tone: "text-amber-500 dark:text-amber-400 bg-amber-500/10",
      label: "pnpm",
    };
  }
  if (base === "yarn.lock") {
    return {
      icon: SiYarn,
      tone: "text-blue-500 dark:text-blue-400 bg-blue-500/10",
      label: "yarn",
    };
  }
  if (base === "bun.lock" || base === "bun.lockb") {
    return {
      icon: SiBun,
      tone: "text-amber-600 dark:text-amber-300 bg-amber-500/10",
      label: "bun",
    };
  }
  if (base.startsWith("vite.config.")) {
    return {
      icon: SiVite,
      tone: "text-purple-600 dark:text-purple-400 bg-purple-500/10",
      label: "Vite",
    };
  }
  if (base.startsWith("tailwind.config.")) {
    return {
      icon: SiTailwindcss,
      tone: "text-cyan-600 dark:text-cyan-400 bg-cyan-500/10",
      label: "Tailwind CSS",
    };
  }
  if (base.startsWith("postcss.config.")) {
    return {
      icon: SiPostcss,
      tone: "text-rose-600 dark:text-rose-400 bg-rose-500/10",
      label: "PostCSS",
    };
  }
  if (base.startsWith("next.config.")) {
    return {
      icon: SiNextdotjs,
      tone: "text-zinc-700 dark:text-zinc-300 bg-zinc-500/10",
      label: "Next.js",
    };
  }
  if (base.startsWith("vitest.config.")) {
    return {
      icon: SiVitest,
      tone: "text-lime-600 dark:text-lime-400 bg-lime-500/10",
      label: "Vitest",
    };
  }
  if (base.startsWith("jest.config.")) {
    return {
      icon: SiJest,
      tone: "text-rose-600 dark:text-rose-400 bg-rose-500/10",
      label: "Jest",
    };
  }
  if (base === "tsconfig.json" || (base.startsWith("tsconfig.") && base.endsWith(".json"))) {
    return {
      icon: SiTypescript,
      tone: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
      label: "TypeScript config",
    };
  }
  if (base === "jsconfig.json" || (base.startsWith("jsconfig.") && base.endsWith(".json"))) {
    return {
      icon: SiJavascript,
      tone: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
      label: "JavaScript config",
    };
  }
  if (
    base === "dockerfile" ||
    base.startsWith("dockerfile.") ||
    base.startsWith("docker-compose") ||
    base === ".dockerignore"
  ) {
    return {
      icon: SiDocker,
      tone: "text-sky-600 dark:text-sky-400 bg-sky-500/10",
      label: "Docker",
    };
  }
  if (base === ".gitignore" || base === ".gitattributes" || base === ".gitmodules") {
    return {
      icon: SiGit,
      tone: "text-orange-600 dark:text-orange-400 bg-orange-500/10",
      label: "Git",
    };
  }
  if (base === ".env" || base.startsWith(".env.")) {
    return {
      icon: FileKey,
      tone: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
      label: "Environment",
    };
  }
  if (base.startsWith(".eslint") || base.startsWith("eslint.config.")) {
    return {
      icon: SiEslint,
      tone: "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10",
      label: "ESLint",
    };
  }
  if (base.startsWith(".prettier") || base.startsWith("prettier.config.")) {
    return {
      icon: SiPrettier,
      tone: "text-rose-500 dark:text-rose-400 bg-rose-500/10",
      label: "Prettier",
    };
  }

  // 2. Extension matching
  const ext = base.includes(".") ? base.split(".").pop() || "" : "";

  switch (ext) {
    case "tsx":
      return {
        icon: SiReact,
        tone: "text-sky-500 dark:text-sky-400 bg-sky-500/10",
        label: "React TypeScript",
      };
    case "jsx":
      return {
        icon: SiReact,
        tone: "text-sky-500 dark:text-sky-400 bg-sky-500/10",
        label: "React JavaScript",
      };
    case "ts":
    case "mts":
    case "cts":
      return {
        icon: SiTypescript,
        tone: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
        label: "TypeScript",
      };
    case "js":
    case "mjs":
    case "cjs":
      return {
        icon: SiJavascript,
        tone: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
        label: "JavaScript",
      };
    case "html":
    case "htm":
      return {
        icon: SiHtml5,
        tone: "text-orange-600 dark:text-orange-400 bg-orange-500/10",
        label: "HTML",
      };
    case "css":
      return {
        icon: SiCss3,
        tone: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
        label: "CSS",
      };
    case "scss":
    case "sass":
    case "less":
      return {
        icon: SiSass,
        tone: "text-pink-600 dark:text-pink-400 bg-pink-500/10",
        label: "Sass",
      };
    case "vue":
      return {
        icon: SiVuedotjs,
        tone: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
        label: "Vue",
      };
    case "svelte":
      return {
        icon: SiSvelte,
        tone: "text-orange-600 dark:text-orange-400 bg-orange-500/10",
        label: "Svelte",
      };
    case "astro":
      return {
        icon: SiAstro,
        tone: "text-purple-600 dark:text-purple-400 bg-purple-500/10",
        label: "Astro",
      };
    case "json":
    case "jsonc":
    case "json5":
      return {
        icon: VscJson,
        tone: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
        label: "JSON",
      };
    case "md":
    case "mdx":
    case "markdown":
      return {
        icon: SiMarkdown,
        tone: "text-teal-700 dark:text-teal-400 bg-teal-500/10",
        label: "Markdown",
      };
    case "py":
    case "pyw":
    case "ipynb":
      return {
        icon: SiPython,
        tone: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
        label: "Python",
      };
    case "rs":
      return {
        icon: SiRust,
        tone: "text-amber-700 dark:text-amber-500 bg-amber-500/10",
        label: "Rust",
      };
    case "go":
      return {
        icon: SiGo,
        tone: "text-cyan-600 dark:text-cyan-400 bg-cyan-500/10",
        label: "Go",
      };
    case "php":
      return {
        icon: SiPhp,
        tone: "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10",
        label: "PHP",
      };
    case "rb":
      return {
        icon: SiRuby,
        tone: "text-red-600 dark:text-red-400 bg-red-500/10",
        label: "Ruby",
      };
    case "swift":
      return {
        icon: SiSwift,
        tone: "text-orange-600 dark:text-orange-400 bg-orange-500/10",
        label: "Swift",
      };
    case "kt":
    case "kts":
      return {
        icon: SiKotlin,
        tone: "text-violet-600 dark:text-violet-400 bg-violet-500/10",
        label: "Kotlin",
      };
    case "c":
    case "cpp":
    case "cc":
    case "cxx":
    case "h":
    case "hpp":
      return {
        icon: SiCplusplus,
        tone: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
        label: "C/C++",
      };
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      return {
        icon: Terminal,
        tone: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10",
        label: "Shell script",
      };
    case "sql":
      return {
        icon: Database,
        tone: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
        label: "SQL",
      };
    case "graphql":
    case "gql":
      return {
        icon: SiGraphql,
        tone: "text-pink-600 dark:text-pink-400 bg-pink-500/10",
        label: "GraphQL",
      };
    case "prisma":
      return {
        icon: SiPrisma,
        tone: "text-teal-700 dark:text-teal-400 bg-teal-500/10",
        label: "Prisma",
      };
    case "yml":
    case "yaml":
      return {
        icon: SiYaml,
        tone: "text-rose-600 dark:text-rose-400 bg-rose-500/10",
        label: "YAML",
      };
    case "svg":
      return {
        icon: SiSvg,
        tone: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
        label: "SVG",
      };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "ico":
    case "avif":
    case "bmp":
    case "tiff":
      return {
        icon: FileImage,
        tone: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
        label: "Image",
      };
    case "mp4":
    case "mov":
    case "avi":
    case "webm":
    case "mkv":
      return {
        icon: FileVideo,
        tone: "text-purple-600 dark:text-purple-400 bg-purple-500/10",
        label: "Video",
      };
    case "mp3":
    case "wav":
    case "ogg":
    case "flac":
    case "m4a":
      return {
        icon: FileAudio,
        tone: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
        label: "Audio",
      };
    case "zip":
    case "tar":
    case "gz":
    case "rar":
    case "7z":
      return {
        icon: FileArchive,
        tone: "text-amber-700 dark:text-amber-400 bg-amber-500/10",
        label: "Archive",
      };
    case "pdf":
      return {
        icon: FileText,
        tone: "text-rose-600 dark:text-rose-400 bg-rose-500/10",
        label: "PDF",
      };
    case "txt":
    case "log":
      return {
        icon: FileText,
        tone: "text-zinc-600 dark:text-zinc-400 bg-zinc-500/10",
        label: "Text",
      };
    default:
      return {
        icon: FileCode,
        tone: "text-zinc-600 dark:text-zinc-400 bg-zinc-500/10",
        label: ext.toUpperCase() || "File",
      };
  }
}

export function FileIcon({
  filename,
  className,
  iconClassName,
}: {
  filename: string;
  className?: string;
  iconClassName?: string;
}) {
  const { icon: Icon, tone, label } = getFileIconMeta(filename);

  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md",
        tone,
        className,
      )}
      title={label}
      aria-label={label}
    >
      <Icon className={cn("size-3.5 shrink-0", iconClassName)} />
    </span>
  );
}
