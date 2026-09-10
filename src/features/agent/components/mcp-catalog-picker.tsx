"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, KeyRound, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { useGetAgentMcpConfig } from "../api/use-agent-mcp-config";
import { useUpdateAgentMcpConfig } from "../api/use-update-agent-mcp-config";
import { AGENT_FIELD_CLASS } from "../constants";
import { missingCatalogItems, withCatalogServer, type McpCatalogItem } from "../lib/mcp-catalog";

export function McpCatalogPicker({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { data } = useGetAgentMcpConfig();
  const update = useUpdateAgentMcpConfig();
  const [tokenFor, setTokenFor] = useState<McpCatalogItem | null>(null);
  const [token, setToken] = useState("");
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const missing = missingCatalogItems(data);
  const items = compact ? missing.slice(0, 4) : missing;

  if (!missing.length) return null;

  const add = (item: McpCatalogItem, credential?: string) => {
    update.mutate(
      { json: withCatalogServer(data, item, credential) },
      {
        onSuccess: () => {
          setJustAdded(item.id);
          setTokenFor(null);
          setToken("");
          window.setTimeout(() => setJustAdded((value) => (value === item.id ? null : value)), 1500);
        },
      },
    );
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between px-0.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recommended servers</p>
        <span className="hidden text-[10px] text-muted-foreground sm:inline">one click · HTTP only, nothing runs locally</span>
      </div>
      <div className={cn("grid gap-2", compact ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}>
        {items.map((item) => {
          const pending = update.isPending && update.variables?.json.mcpServers?.[item.id] !== undefined;
          const added = justAdded === item.id;
          return (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="group flex items-start gap-2.5 rounded-xl border border-border/70 bg-card p-2.5 transition-colors hover:border-primary/30 hover:bg-muted/30"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <i className={cn(item.icon, item.iconClassName, "text-sm")} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-[12px] font-semibold text-foreground">{item.name}</p>
                  {!compact && item.tags.includes("popular") ? (
                    <span className="rounded-full bg-amber-500/15 px-1.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">popular</span>
                  ) : null}
                </div>
                <p className="line-clamp-2 text-[10.5px] leading-4 text-muted-foreground">{item.description}</p>
                <AnimatePresence initial={false}>
                  {tokenFor?.id === item.id ? (
                    <motion.form
                      key="token"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 space-y-1.5 overflow-hidden"
                      onSubmit={(event) => {
                        event.preventDefault();
                        add(item, token);
                      }}
                    >
                      <Input
                        autoFocus
                        type="password"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        placeholder={item.authHint || "token"}
                        className={cn("h-8 font-mono text-[11px]", AGENT_FIELD_CLASS)}
                      />
                      <div className="flex items-center gap-1.5">
                        <Button type="submit" size="xs" disabled={update.isPending}>
                          {pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Add
                        </Button>
                        <Button type="button" size="xs" variant="ghost" onClick={() => setTokenFor(null)}>
                          Cancel
                        </Button>
                        <Button type="button" size="xs" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => add(item)}>
                          Add without token
                        </Button>
                      </div>
                    </motion.form>
                  ) : null}
                </AnimatePresence>
              </div>
              {tokenFor?.id !== item.id ? (
                <Button
                  type="button"
                  size="xs"
                  variant={added ? "secondary" : "outline"}
                  className="shrink-0 gap-1"
                  disabled={update.isPending}
                  onClick={() => (item.authHeader ? setTokenFor(item) : add(item))}
                  title={item.authHeader ? "Needs a token" : "Add server"}
                >
                  {added ? <Check className="size-3 text-emerald-500" /> : pending ? <Loader2 className="size-3 animate-spin" /> : item.authHeader ? <KeyRound className="size-3" /> : <Plus className="size-3" />}
                  {added ? "Added" : "Add"}
                </Button>
              ) : null}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
