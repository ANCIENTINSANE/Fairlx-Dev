"use client";

import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Check, GitBranch, GitPullRequest, KeyRound, Loader2, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useGetOAuthStatus } from "@/features/github-integration/api/use-github";

import { useConnectAgentPlugin } from "../api/use-agent-plugins";
import { AGENT_FIELD_CLASS } from "../constants";

export type GithubConnectRequest = {
  runId?: string;
  projectId?: string;
  /** Why the agent needs GitHub right now — shown as the headline so nobody has to guess. */
  reason?: string;
};

const PERKS = [
  { icon: GitBranch, text: "Clone your repo into an Azure sandbox and run it" },
  { icon: GitPullRequest, text: "Commit on a fairlx/ branch and open pull requests" },
  { icon: ShieldCheck, text: "One sign-in for every Fairlx project — revoke anytime" },
];

function Orbit() {
  return (
    <div className="relative mx-auto flex size-24 items-center justify-center" style={{ perspective: 400 }}>
      <motion.div
        className="absolute inset-0 rounded-full border border-dashed border-foreground/15"
        animate={{ rotateX: 65, rotateZ: [0, 360] }}
        transition={{ rotateZ: { duration: 12, repeat: Infinity, ease: "linear" } }}
        style={{ transformStyle: "preserve-3d" }}
      >
        <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-emerald-500 shadow-[0_0_10px_2px_rgba(16,185,129,0.6)]" />
      </motion.div>
      <motion.div
        className="absolute inset-3 rounded-full border border-dashed border-foreground/10"
        animate={{ rotateX: 65, rotateZ: [360, 0] }}
        transition={{ rotateZ: { duration: 8, repeat: Infinity, ease: "linear" } }}
        style={{ transformStyle: "preserve-3d" }}
      >
        <span className="absolute -bottom-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-violet-500 shadow-[0_0_8px_2px_rgba(139,92,246,0.6)]" />
      </motion.div>
      <motion.div
        animate={{ y: [0, -4, 0], rotateY: [0, 12, 0, -12, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="relative flex size-14 items-center justify-center rounded-2xl bg-foreground text-background shadow-xl"
        style={{ transformStyle: "preserve-3d" }}
      >
        <FaGithub className="size-8" />
      </motion.div>
    </div>
  );
}

export function GithubConnectDialog({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: GithubConnectRequest | null;
}) {
  const { data: oauth } = useGetOAuthStatus();
  const oauthConfigured = oauth?.oauthConfigured ?? false;
  const connect = useConnectAgentPlugin();
  const [mode, setMode] = useState<"pick" | "token">("pick");
  const [token, setToken] = useState("");
  const [redirecting, setRedirecting] = useState(false);

  const signIn = () => {
    const params = new URLSearchParams();
    if (request?.runId) params.set("runId", request.runId);
    if (request?.projectId) params.set("projectId", request.projectId);
    setRedirecting(true);
    window.location.href = `/api/github/oauth/authorize?${params.toString()}`;
  };

  const submitToken = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      toast.error("Paste a GitHub token first.");
      return;
    }
    connect.mutate(
      { json: { catalogId: "github", fields: { token: trimmed }, runId: request?.runId } },
      {
        onSuccess: () => {
          toast.success("GitHub connected. The agent is picking up where it left off.");
          setToken("");
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setMode("pick");
      }}
    >
      <DialogContent className="max-w-md overflow-hidden border-border/70 p-0">
        <div className="relative bg-gradient-to-b from-violet-500/10 via-fuchsia-500/5 to-transparent px-6 pb-4 pt-7">
          <div className="pointer-events-none absolute -left-10 -top-10 size-40 rounded-full bg-violet-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -right-10 top-4 size-32 rounded-full bg-emerald-500/10 blur-3xl" />
          <Orbit />
          <DialogTitle className="mt-4 text-center text-lg font-semibold tracking-tight">
            {request?.reason ? "Let’s plug in GitHub" : "Connect GitHub"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-center text-[13px] leading-relaxed">
            {request?.reason || "The agent needs GitHub to keep going. Sign in once and it never asks again."}
          </DialogDescription>
        </div>

        <div className="space-y-4 px-6 pb-6">
          <ul className="space-y-1.5">
            {PERKS.map((perk) => (
              <li key={perk.text} className="flex items-center gap-2.5 text-[12px] text-muted-foreground">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-foreground/80">
                  <perk.icon className="size-3.5" />
                </span>
                {perk.text}
              </li>
            ))}
          </ul>

          {mode === "pick" ? (
            <div className="space-y-2">
              <Button
                type="button"
                className="h-10 w-full gap-2 bg-foreground text-background hover:bg-foreground/90"
                disabled={!oauthConfigured || redirecting}
                onClick={signIn}
              >
                {redirecting ? <Loader2 className="size-4 animate-spin" /> : <FaGithub className="size-4" />}
                Sign in with GitHub
                <ArrowRight className="ml-auto size-4 opacity-60" />
              </Button>
              {!oauthConfigured ? (
                <p className="text-center text-[11px] text-muted-foreground">
                  GitHub OAuth isn’t configured on this Fairlx instance — use a token below.
                </p>
              ) : null}
              <Button type="button" variant="outline" className="h-10 w-full gap-2" onClick={() => setMode("token")}>
                <KeyRound className="size-4" />
                Use a personal access token
              </Button>
            </div>
          ) : (
            <form onSubmit={submitToken} className="space-y-3">
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
                Create a <span className="font-medium text-foreground">classic token</span> with{" "}
                <code className="rounded bg-muted px-1 font-mono text-[10.5px]">repo</code> and{" "}
                <code className="rounded bg-muted px-1 font-mono text-[10.5px]">read:org</code> at{" "}
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo,read:org&description=Fairlx%20Agent"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  github.com/settings/tokens
                </a>
                . Fairlx stores it encrypted.
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="password"
                  autoFocus
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="ghp_…"
                  className={cn("h-10 pl-9 font-mono", AGENT_FIELD_CLASS)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setMode("pick")}>
                  Back
                </Button>
                <Button type="submit" size="sm" className="ml-auto gap-1.5" disabled={connect.isPending}>
                  {connect.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  Connect with token
                </Button>
              </div>
            </form>
          )}

          <p className="flex items-center justify-center gap-1 text-[10.5px] text-muted-foreground">
            <Sparkles className="size-3 text-amber-500" />
            After connecting, the agent resumes automatically.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
