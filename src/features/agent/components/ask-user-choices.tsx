"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

import { ASK_USER_CUSTOM_VALUE, splitChoiceLabel } from "../lib/ask-user";

export function AskUserChoices({
  choices,
  allowCustom = true,
  enabled,
  compact,
  onSubmit,
}: {
  choices: string[];
  allowCustom?: boolean;
  enabled: boolean;
  compact?: boolean;
  onSubmit: (choice: string) => void;
}) {
  const customId = useId();
  const [selected, setSelected] = useState("");
  const [custom, setCustom] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isCustom = selected === ASK_USER_CUSTOM_VALUE;
  const answer = isCustom ? custom.trim() : selected;
  const canSend = enabled && Boolean(answer);

  useEffect(() => {
    if (isCustom && enabled) inputRef.current?.focus();
  }, [isCustom, enabled]);

  if (!choices.length && !allowCustom) return null;

  const submit = () => {
    if (!canSend) return;
    onSubmit(answer);
    setCustom("");
  };

  const rowPad = compact ? "px-3 py-2.5" : "px-3.5 py-3";

  return (
    <form
      className={cn("mt-3 max-w-xl", compact && "mt-2.5")}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <RadioGroup
          value={selected}
          onValueChange={setSelected}
          disabled={!enabled}
          className="gap-0"
          aria-label="Choose an option"
        >
          {choices.map((choice, index) => {
            const { title, description } = splitChoiceLabel(choice);
            const optionId = `${customId}-option-${index}`;
            const active = selected === choice;
            return (
              <label
                key={choice}
                htmlFor={optionId}
                className={cn(
                  "flex items-start gap-3 border-b border-border/70 transition-colors",
                  rowPad,
                  enabled ? "cursor-pointer hover:bg-muted/40" : "cursor-default",
                  active && "bg-muted/50",
                )}
              >
                <RadioGroupItem
                  value={choice}
                  id={optionId}
                  className="mt-0.5 shrink-0 border-muted-foreground/50 data-[state=checked]:border-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium leading-snug text-foreground">{title}</span>
                  {description ? (
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{description}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
          {allowCustom ? (
            <div
              className={cn(
                "flex items-start gap-3 transition-colors",
                rowPad,
                enabled ? "cursor-pointer hover:bg-muted/40" : "cursor-default",
                isCustom && "bg-muted/50",
              )}
              onClick={() => {
                if (enabled) setSelected(ASK_USER_CUSTOM_VALUE);
              }}
            >
              <RadioGroupItem
                value={ASK_USER_CUSTOM_VALUE}
                id={customId}
                className="mt-0.5 shrink-0 border-muted-foreground/50 data-[state=checked]:border-primary"
              />
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={customId}
                  className={cn("block text-[13px] font-medium leading-snug text-foreground", enabled && "cursor-pointer")}
                >
                  Type your own…
                </label>
                {enabled && isCustom ? (
                  <input
                    ref={inputRef}
                    type="text"
                    autoComplete="off"
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                    disabled={!enabled}
                    placeholder="What do you want instead?"
                    onClick={(event) => event.stopPropagation()}
                    className="mt-2 h-8 w-full rounded-md border border-primary/40 bg-background px-2.5 text-[13px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/60"
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </RadioGroup>
        {enabled ? (
          <div className="flex justify-end border-t border-border bg-muted/20 px-3 py-2">
            <Button type="submit" size="xs" disabled={!canSend}>
              Send
            </Button>
          </div>
        ) : null}
      </div>
    </form>
  );
}
