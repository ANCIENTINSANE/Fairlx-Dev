"use client";

import { cn } from "@/lib/utils";

import type { ComposerShortcut } from "../lib/composer-shortcuts";

export function ComposerShortcutMenu({
  items,
  activeIndex,
  onSelect,
  onHover,
}: {
  items: ComposerShortcut[];
  activeIndex: number;
  onSelect: (item: ComposerShortcut) => void;
  onHover: (index: number) => void;
}) {
  if (!items.length) return null;
  return (
    <ul
      role="listbox"
      aria-label="Composer shortcuts"
      className="absolute bottom-full left-2 right-2 z-30 mb-1 max-h-56 overflow-y-auto rounded-xl border border-border/80 bg-card/95 py-1 shadow-lg backdrop-blur-md"
    >
      {items.map((item, index) => (
        <li key={`${item.kind}-${item.id}`}>
          <button
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            aria-label={item.label}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]",
              index === activeIndex ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(item);
            }}
            onMouseEnter={() => onHover(index)}
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/60 font-mono text-[11px] text-foreground">
              {item.kind === "slash" ? "/" : "@"}
            </span>
            <span className="font-mono font-semibold text-foreground">{item.label}</span>
            <span className="truncate text-[11px]">{item.hint}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
