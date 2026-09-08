"use client";

import { useEffect, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { FaGithub } from "react-icons/fa";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  useConnectGithubAccountToken,
  useDisconnectGithubAccount,
  useGetGithubAccount,
} from "../api/use-github";

export function GithubAccountMenu() {
  const pathname = usePathname();
  const { data, isLoading, isError } = useGetGithubAccount();
  const connectToken = useConnectGithubAccountToken();
  const disconnect = useDisconnectGithubAccount();
  const [showPat, setShowPat] = useState(false);
  const [token, setToken] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const account = data?.data;
  const oauthConfigured = Boolean(data?.oauthConfigured);
  const connected = Boolean(account?.hasRepoAccess);
  const login = account?.githubLogin;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth") !== "success") return;
    const githubUser = params.get("github_user");
    toast.success(githubUser ? `GitHub connected as @${githubUser}` : "GitHub connected");
    params.delete("oauth");
    params.delete("github_user");
    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    window.history.replaceState({}, document.title, next);
  }, []);

  const startOauth = () => {
    const params = new URLSearchParams();
    if (pathname) params.set("returnTo", pathname);
    window.location.href = `/api/github/oauth/authorize?${params.toString()}`;
  };

  const onConnectPat = (event: FormEvent) => {
    event.preventDefault();
    const value = token.trim();
    if (!value) return;
    connectToken.mutate(value, {
      onSuccess: () => {
        setToken("");
        setShowPat(false);
      },
    });
  };

  return (
    <div
      className="px-2.5 py-2"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-0.5 mb-2">
        GitHub
      </p>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground h-9 px-1">
          <Loader2 className="size-3.5 animate-spin" />
          Checking GitHub…
        </div>
      ) : isError ? (
        <p className="text-[11px] text-muted-foreground px-0.5">
          Couldn’t load GitHub status. Open this menu again in a moment.
        </p>
      ) : connected ? (
        <div className="rounded-lg border border-border bg-muted/40 px-2.5 py-2 space-y-2">
          <div className="flex items-start gap-2">
            <div className="size-8 rounded-md bg-neutral-900 text-white flex items-center justify-center shrink-0">
              <FaGithub className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">
                {login ? `@${login}` : "GitHub connected"}
              </p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Fairlx Agent and projects use this account to read and write git.
              </p>
            </div>
          </div>
          {confirmDisconnect ? (
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-7 text-[11px] flex-1"
                disabled={disconnect.isPending}
                onClick={() => {
                  void disconnect.mutateAsync().finally(() => setConfirmDisconnect(false));
                }}
              >
                {disconnect.isPending ? "Disconnecting…" : "Confirm disconnect"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => setConfirmDisconnect(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[11px] flex-1"
                disabled={!oauthConfigured}
                onClick={startOauth}
              >
                Reconnect
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-[11px] text-destructive hover:text-destructive"
                onClick={() => setConfirmDisconnect(true)}
              >
                Disconnect
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border px-2.5 py-2 space-y-2">
          <div className="flex items-start gap-2">
            <div className="size-8 rounded-md bg-neutral-900 text-white flex items-center justify-center shrink-0">
              <FaGithub className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Not connected</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Authorize once. Fairlx uses this GitHub user for the Agent, repos, and PRs.
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            className="h-8 w-full text-xs"
            disabled={!oauthConfigured}
            onClick={startOauth}
          >
            Connect GitHub
          </Button>
          {!oauthConfigured ? (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              GitHub OAuth is not configured on this server. Use a personal access token.
            </p>
          ) : null}
          {showPat ? (
            <form className="space-y-1.5" onSubmit={onConnectPat}>
              <Input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="ghp_… classic PAT with repo and read:org"
                className="h-8"
                autoComplete="off"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                className="h-7 w-full text-[11px]"
                disabled={connectToken.isPending || token.trim().length < 8}
              >
                {connectToken.isPending ? "Connecting…" : "Save token"}
              </Button>
            </form>
          ) : (
            <button
              type="button"
              className={cn(
                "flex w-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setShowPat(true)}
            >
              <KeyRound className="size-3" />
              Use a personal access token
            </button>
          )}
        </div>
      )}
    </div>
  );
}
