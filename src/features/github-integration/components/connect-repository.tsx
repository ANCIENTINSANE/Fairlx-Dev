"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2, Trash2, AlertCircle, RefreshCw, Github, KeyRound, ArrowLeft, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useConfirm } from "@/hooks/use-confirm";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { 
  useLinkRepository, 
  useDisconnectRepository, 
  useGetRepository, 
  useGetOAuthStatus,
  useGetGitHubRepos,
  useGetGitHubBranches,
  useGetGithubAccount,
  useGetGithubOwners,
  useCreateGithubRepository,
} from "../api/use-github";
import { TokenGuide } from "./token-guide";
import { githubAPI } from "../lib/github-api";

const formSchema = z.object({
  githubUrl: z
    .string()
    .min(1, "GitHub URL is required")
    .url("Must be a valid URL")
    .refine(
      (url) => url.includes("github.com"),
      "Must be a GitHub repository URL"
    ),
  branch: z.string().min(1, "Branch name is required").default("main"),
  githubToken: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface ConnectRepositoryProps {
  projectId: string;
  isUpdate?: boolean;
  canManage?: boolean;
  trigger?: ReactNode;
}

export const ConnectRepository = ({
  projectId,
  isUpdate = false,
  canManage = false,
  trigger,
}: ConnectRepositoryProps) => {
  const [open, setOpen] = useState(false);
  const [connectionStep, setConnectionStep] = useState<"choose" | "form" | "select-repo" | "create-repo">("choose");
  const [isCheckingRepo, setIsCheckingRepo] = useState(false);
  const [repoValidation, setRepoValidation] = useState<{
    isPrivate: boolean;
    needsToken: boolean;
    error?: string;
  } | null>(null);
  
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<"all" | string>("all");
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoDescription, setNewRepoDescription] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [newRepoOwner, setNewRepoOwner] = useState("");

  const { data: repository } = useGetRepository(projectId);
  const { mutate: linkRepository, isPending: isLinking } = useLinkRepository();
  const { mutate: disconnectRepository, isPending: isDisconnecting } =
    useDisconnectRepository();
  const { mutate: createGithubRepo, isPending: isCreatingRepo } = useCreateGithubRepository();
  const { data: githubAccountPayload } = useGetGithubAccount();
  const githubAccount = githubAccountPayload?.data;
  const isAccountConnected = Boolean(githubAccount?.hasRepoAccess ?? githubAccount?.connected);

  const isPendingOAuthSetup = repository?.status === "authenticating" || repository?.githubUrl === "pending";

  const { data: repos, isLoading: isLoadingRepos, error: reposError } = useGetGitHubRepos(
    projectId,
    (connectionStep === "select-repo" || connectionStep === "create-repo") && (isPendingOAuthSetup || isAccountConnected)
  );
  const { data: ownerPayload } = useGetGithubOwners(
    (connectionStep === "select-repo" || connectionStep === "create-repo") && isAccountConnected
  );
  const githubOwners = useMemo(() => ownerPayload?.owners ?? [], [ownerPayload?.owners]);

  const [parsedOwner, parsedRepoName] = selectedRepo ? selectedRepo.split("/") : ["", ""];
  const { data: branches, isLoading: isLoadingBranches } = useGetGitHubBranches(
    projectId,
    parsedOwner || "",
    parsedRepoName || "",
    connectionStep === "select-repo" && !!selectedRepo
  );
  
  // Check if server-side GitHub OAuth is configured
  const { data: oauthStatus } = useGetOAuthStatus();
  const oauthConfigured = oauthStatus?.oauthConfigured ?? false;
  const [authMethod, setAuthMethod] = useState<"oauth" | "pat">("oauth");

  useEffect(() => {
    if (oauthConfigured) {
      setAuthMethod("oauth");
    } else {
      setAuthMethod("pat");
    }
  }, [oauthConfigured]);

  // Auto-open and route to select-repo if redirected from OAuth, already authenticating, or GitHub is already connected Fairlx-wide.
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const isOauthSuccess = urlParams.get("oauth") === "success";
      
      if (isPendingOAuthSetup || (isAccountConnected && isOauthSuccess)) {
        setConnectionStep("select-repo");
        if (isOauthSuccess) {
          setOpen(true);
          const newUrl = window.location.pathname + window.location.search.replace(/[\?&]oauth=success/, "").replace(/[\?&]github_user=[^&]+/, "");
          window.history.replaceState({}, document.title, newUrl);
        }
      }
    }
  }, [repository, isPendingOAuthSetup, isAccountConnected]);

  useEffect(() => {
    if (isAccountConnected && open && connectionStep === "choose" && !isUpdate) {
      setConnectionStep("select-repo");
    }
  }, [isAccountConnected, open, connectionStep, isUpdate]);

  useEffect(() => {
    if (githubOwners.length === 1 && !newRepoOwner) {
      setNewRepoOwner(githubOwners[0]!.login);
    }
  }, [githubOwners, newRepoOwner]);

  // Reset dialog state when closed
  useEffect(() => {
    if (!open) {
      if (isPendingOAuthSetup) {
        setConnectionStep("select-repo");
      } else {
        setConnectionStep("choose");
      }
      setRepoValidation(null);
    }
  }, [open, isPendingOAuthSetup]);

  const [ConfirmDialog, confirm] = useConfirm(
    "Disconnect Repository",
    "Are you sure you want to disconnect this repository? Documentation and commit data will be preserved but won't be updated.",
    "destructive"
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      githubUrl: repository?.githubUrl || "",
      branch: repository?.branch || "main",
      githubToken: "",
    },
  });

  // Watch for URL changes and validate repository
  const githubUrl = form.watch("githubUrl");
  const githubToken = form.watch("githubToken");

  useEffect(() => {
    const checkRepository = async () => {
      // If using OAuth, we verify on callback, but we can still check public access
      if (!githubUrl || !githubUrl.includes("github.com/")) {
        setRepoValidation(null);
        return;
      }

      // Parse GitHub URL first to validate format
      let owner: string, repo: string;
      try {
        const parsed = githubAPI.parseGitHubUrl(githubUrl);
        owner = parsed.owner;
        repo = parsed.repo;
        
        // Don't check if we don't have both owner and repo
        if (!owner || !repo) {
          setRepoValidation(null);
          return;
        }
      } catch {
        setRepoValidation(null);
        return;
      }

      try {
        setIsCheckingRepo(true);
        
        // Create API instance with token if provided (only for PAT check)
        const { GitHubAPI } = await import("../lib/github-api");
        const api = new GitHubAPI(githubToken || undefined);
        const result = await api.checkRepositoryAccess(owner, repo);
        
        setRepoValidation({
          isPrivate: result.isPrivate,
          needsToken: authMethod === "pat" ? result.needsToken : false,
          error: result.error,
        });
      } catch {
        setRepoValidation(null);
      } finally {
        setIsCheckingRepo(false);
      }
    };

    // Increase debounce time to 1 second to avoid excessive API calls
    const timeoutId = setTimeout(checkRepository, 1000);
    return () => clearTimeout(timeoutId);
  }, [githubUrl, githubToken, authMethod]);

  const onSubmit = (values: FormValues) => {
    if (authMethod === "oauth") {
      // Direct user to OAuth authorization route
      const authorizeUrl = `/api/github/oauth/authorize?projectId=${projectId}&githubUrl=${encodeURIComponent(values.githubUrl)}&branch=${encodeURIComponent(values.branch)}`;
      window.location.href = authorizeUrl;
      return;
    }

    // Validate private repository has token
    if (repoValidation?.needsToken && !values.githubToken) {
      form.setError("githubToken", {
        type: "manual",
        message: "GitHub token is required for private repositories",
      });
      return;
    }

    linkRepository(
      {
        json: { ...values, projectId },
      },
      {
        onSuccess: () => {
          setOpen(false);
          form.reset();
          setRepoValidation(null);
        },
      }
    );
  };

  const handleDisconnect = async () => {
    if (!repository) return;

    const ok = await confirm();
    if (!ok) return;

    disconnectRepository({
      param: { repositoryId: repository.$id },
      projectId,
    });
  };

  const renderFormContent = () => (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Back navigation */}
        <button
          type="button"
          onClick={() => setConnectionStep("choose")}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
        >
          <ArrowLeft className="size-3.5" />
          Choose different authentication method
        </button>

        <FormField
          control={form.control}
          name="githubUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>GitHub Repository URL</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    placeholder="https://github.com/username/repository"
                    {...field}
                    disabled={isLinking}
                  />
                  {isCheckingRepo && (
                    <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </FormControl>
              <FormDescription>
                The full URL of your GitHub repository
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="branch"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Branch</FormLabel>
              <FormControl>
                <Input
                  placeholder="main"
                  {...field}
                  disabled={isLinking}
                />
              </FormControl>
              <FormDescription>
                The branch to analyze (e.g., main, master, develop)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {authMethod === "pat" && (
          <FormField
            control={form.control}
            name="githubToken"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel className={repoValidation?.needsToken ? "text-destructive" : ""}>
                    GitHub Token {repoValidation?.needsToken && <span className="text-destructive">*</span>}
                    {!repoValidation?.needsToken && <span className="text-muted-foreground font-normal">(optional, for private repositories)</span>}
                  </FormLabel>
                  <TokenGuide />
                </div>
                <FormControl>
                  <Input
                    type="password"
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    {...field}
                    disabled={isLinking}
                    className={repoValidation?.needsToken && !field.value ? "border-destructive focus-visible:ring-destructive" : ""}
                  />
                </FormControl>
                {repoValidation?.needsToken && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      This is a private repository. Please provide a GitHub token to proceed.
                    </AlertDescription>
                  </Alert>
                )}
                {repoValidation?.isPrivate && !repoValidation.needsToken && (
                  <Alert className="mt-2 border-green-200 bg-green-50 dark:bg-green-950/20">
                    <AlertCircle className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-xs text-green-800 dark:text-green-200">
                      ✓ Private repository access verified
                    </AlertDescription>
                  </Alert>
                )}
                {!repoValidation?.isPrivate && repoValidation && (
                  <Alert className="mt-2 border-green-200 bg-green-50 dark:bg-green-950/20">
                    <AlertCircle className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-xs text-green-800 dark:text-green-200">
                      ✓ This is a public repository. Token is optional.
                    </AlertDescription>
                  </Alert>
                )}
                {!repoValidation && (
                  <FormDescription>
                    Personal access token for private repositories. Leave empty for public repos.
                  </FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {authMethod === "oauth" && repoValidation?.isPrivate && (
          <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-xs text-blue-800 dark:text-blue-200">
              This is a private repository. Clicking submit will redirect you to authorize Fairlx on GitHub.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isLinking}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isLinking}>
            {isLinking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {authMethod === "oauth" ? "Connect via OAuth 2.0" : isUpdate ? "Update Repository" : "Connect Repository"}
          </Button>
        </div>
      </form>
    </Form>
  );

  const renderSelectRepoStep = () => {
    const handleRepoChange = (val: string) => {
      setSelectedRepo(val);
      const matched = repos?.find(r => r.full_name === val);
      if (matched) {
        setSelectedBranch(matched.default_branch || "main");
      } else {
        setSelectedBranch("main");
      }
    };

    const handleConnectOAuthRepo = () => {
      if (!selectedRepo) return;
      linkRepository({
        json: {
          projectId,
          githubUrl: `https://github.com/${selectedRepo}`,
          branch: selectedBranch || "main",
        }
      }, {
        onSuccess: () => {
          setOpen(false);
          setSelectedRepo("");
          setSelectedBranch("");
        }
      });
    };

    const ownersFromRepos = Array.from(new Set((repos ?? []).map((repo) => repo.owner.login)));
    const ownerOptions = githubOwners.length
      ? githubOwners.map((item) => item.login)
      : ownersFromRepos;
    const visibleRepos = (repos ?? []).filter((repo) => ownerFilter === "all" || repo.owner.login === ownerFilter);

    return (
      <div className="space-y-4 py-2">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold font-sans">Link GitHub Repository</DialogTitle>
          <DialogDescription className="text-xs font-normal text-muted-foreground font-sans">
            {githubAccount?.githubLogin
              ? `Connected as @${githubAccount.githubLogin}. Pick an existing repository or create a new one.`
              : "Select the repository and default branch you want to link to this project."}
          </DialogDescription>
        </DialogHeader>

        {isLoadingRepos ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground font-sans">Fetching your GitHub repositories...</p>
          </div>
        ) : reposError ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription className="text-xs font-sans">
              Failed to load repositories. Sign in with GitHub again, or paste a PAT. {reposError.message}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {ownerOptions.length > 1 ? (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground font-sans">Account</label>
                <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                  <SelectTrigger className="w-full text-xs font-sans h-10 bg-background border border-input rounded-md px-3 py-2">
                    <SelectValue placeholder="All accounts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs font-sans">All accounts</SelectItem>
                    {ownerOptions.map((login) => (
                      <SelectItem key={login} value={login} className="text-xs font-sans">
                        {githubOwners.find((item) => item.login === login)?.type === "Organization"
                          ? `Organization · ${login}`
                          : `Personal · ${login}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground font-sans">Select Repository</label>
              <Select
                value={selectedRepo}
                onValueChange={handleRepoChange}
              >
                <SelectTrigger className="w-full text-xs font-sans h-10 bg-background border border-input rounded-md px-3 py-2">
                  <SelectValue placeholder="-- Choose a Repository --" />
                </SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {visibleRepos.map((repo) => (
                    <SelectItem key={repo.id} value={repo.full_name} className="text-xs font-sans cursor-pointer">
                      <div className="flex items-center justify-between w-full min-w-[280px] gap-2">
                        <span className="truncate">{repo.full_name}</span>
                        <span className={cn(
                          "text-[9px] font-semibold px-1.5 py-0.5 rounded border ml-auto shrink-0",
                          repo.private 
                            ? "bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/10" 
                            : "bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/10"
                        )}>
                          {repo.private ? "Private" : "Public"}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedRepo && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground font-sans">Select Branch</label>
                {isLoadingBranches ? (
                  <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/20">
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground font-sans">Loading branches...</span>
                  </div>
                ) : (
                  <Select
                    value={selectedBranch}
                    onValueChange={setSelectedBranch}
                  >
                    <SelectTrigger className="w-full text-xs font-mono h-10 bg-background border border-input rounded-md px-3 py-2">
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches && branches.length > 0 ? (
                        branches.map((branch) => (
                          <SelectItem key={branch.name} value={branch.name} className="text-xs font-mono cursor-pointer">
                            {branch.name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="main" className="text-xs font-mono">main</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-[11px] text-muted-foreground font-sans">
                  Choose the primary branch for commit history and AI code Q&A analysis.
                </p>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              className="w-full font-sans text-xs"
              onClick={() => setConnectionStep("create-repo")}
            >
              <Plus className="size-3.5 mr-1.5" />
              Create a new repository
            </Button>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (isAccountConnected) {
                    setConnectionStep("choose");
                  } else {
                    setOpen(false);
                  }
                }}
                disabled={isLinking}
                className="font-sans text-xs"
              >
                {isAccountConnected ? "Reconnect" : "Cancel"}
              </Button>
              <Button
                type="button"
                onClick={handleConnectOAuthRepo}
                disabled={isLinking || !selectedRepo}
                className="font-sans text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isLinking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Link Repository
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderCreateRepoStep = () => {
    const ownerChoices = githubOwners.length
      ? githubOwners
      : Array.from(new Set((repos ?? []).map((repo) => repo.owner.login))).map((login) => ({
          login,
          type: (githubAccount?.githubLogin && login === githubAccount.githubLogin ? "User" : "Organization") as "User" | "Organization",
        }));

    const handleCreate = () => {
      const name = newRepoName.trim();
      if (!name) return;
      if (ownerChoices.length > 1 && !newRepoOwner) return;
      createGithubRepo({
        name,
        owner: newRepoOwner || ownerChoices[0]?.login,
        description: newRepoDescription.trim() || undefined,
        private: newRepoPrivate,
        autoInit: true,
        projectId,
        linkToProject: true,
      }, {
        onSuccess: () => {
          setOpen(false);
          setNewRepoName("");
          setNewRepoDescription("");
        },
      });
    };

    return (
      <div className="space-y-4 py-2">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold font-sans">Create GitHub repository</DialogTitle>
          <DialogDescription className="text-xs font-normal text-muted-foreground font-sans">
            Creates the repo with a README, then links it to this project. If you have organizations, choose where it should live.
          </DialogDescription>
        </DialogHeader>

        {ownerChoices.length > 1 ? (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground font-sans">Create under</label>
            <Select value={newRepoOwner} onValueChange={setNewRepoOwner}>
              <SelectTrigger className="w-full text-xs font-sans h-10">
                <SelectValue placeholder="Personal account or organization" />
              </SelectTrigger>
              <SelectContent>
                {ownerChoices.map((owner) => (
                  <SelectItem key={owner.login} value={owner.login} className="text-xs font-sans">
                    {owner.type === "Organization" ? `Organization · ${owner.login}` : `Personal · ${owner.login}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : ownerChoices[0] ? (
          <p className="text-xs text-muted-foreground font-sans">
            Creating under personal account @{ownerChoices[0].login}.
          </p>
        ) : null}

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground font-sans">Repository name</label>
          <Input
            value={newRepoName}
            onChange={(event) => setNewRepoName(event.target.value)}
            placeholder="agent-harness"
            className="h-10 text-xs font-sans"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground font-sans">Description</label>
          <Input
            value={newRepoDescription}
            onChange={(event) => setNewRepoDescription(event.target.value)}
            placeholder="Optional"
            className="h-10 text-xs font-sans"
          />
        </div>
        <label className="flex items-center gap-2 text-xs font-sans">
          <input
            type="checkbox"
            checked={newRepoPrivate}
            onChange={(event) => setNewRepoPrivate(event.target.checked)}
          />
          Private repository
        </label>
        <p className="text-[11px] text-muted-foreground font-sans">
          A README is added automatically so the default branch exists immediately.
        </p>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            className="font-sans text-xs"
            onClick={() => setConnectionStep("select-repo")}
            disabled={isCreatingRepo}
          >
            <ArrowLeft className="size-3.5 mr-1.5" />
            Back
          </Button>
          <Button
            type="button"
            className="font-sans text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white"
            onClick={handleCreate}
            disabled={isCreatingRepo || !newRepoName.trim() || (ownerChoices.length > 1 && !newRepoOwner)}
          >
            {isCreatingRepo && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create and link
          </Button>
        </div>
      </div>
    );
  };

  const renderChooseStep = (title: string, desc: string) => (
    <div className="space-y-5 py-2">
      <DialogHeader>
        <DialogTitle className="text-base font-semibold font-sans">{title}</DialogTitle>
        <DialogDescription className="text-xs font-normal text-muted-foreground font-sans">
          {desc}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 pt-1">
        {/* Method 1: OAuth */}
        <button
          type="button"
          onClick={() => {
            if (oauthConfigured) {
              const authorizeUrl = `/api/github/oauth/authorize?projectId=${projectId}`;
              window.location.href = authorizeUrl;
            }
          }}
          disabled={!oauthConfigured}
          className={cn(
            "flex items-start gap-4 p-4 rounded-xl border text-left transition-all duration-200",
            oauthConfigured
              ? "hover:border-blue-500 hover:bg-blue-500/5 cursor-pointer bg-card/60"
              : "opacity-60 cursor-not-allowed bg-muted/20 border-dashed"
          )}
        >
          <div className="size-10 rounded-lg bg-neutral-900 flex items-center justify-center text-white flex-shrink-0">
            <Github className="size-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-foreground">Sign in with GitHub</span>
              <span className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold px-2 py-0.5 rounded-full">
                Recommended
              </span>
            </div>
            <p className="text-xs text-muted-foreground font-normal leading-relaxed">
              Authorize Fairlx once. Access applies to every project. GitHub will ask for repository read/write, organization list, and webhook access.
            </p>
            {!oauthConfigured && (
              <p className="text-[10px] text-amber-500 font-medium pt-1">
                GitHub OAuth client credentials are not configured on the server.
              </p>
            )}
          </div>
        </button>

        {/* Method 2: PAT */}
        <button
          type="button"
          onClick={() => {
            setAuthMethod("pat");
            setConnectionStep("form");
          }}
          className="flex items-start gap-4 p-4 rounded-xl border text-left transition-all duration-200 hover:border-blue-500 hover:bg-blue-500/5 cursor-pointer bg-card/60"
        >
          <div className="size-10 rounded-lg bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center text-blue-600 dark:text-blue-400 flex-shrink-0">
            <KeyRound className="size-5" />
          </div>
          <div className="space-y-1">
            <span className="text-sm font-semibold text-foreground">GitHub Personal Access Token (PAT)</span>
            <p className="text-xs text-muted-foreground font-normal leading-relaxed">
              Provide a developer access token manually. Good for enterprise or custom permission sets.
            </p>
          </div>
        </button>
      </div>

      <div className="flex justify-end pt-2">
        <Button variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );

  if (isUpdate && repository) {
    if (!canManage) return null;
    return (
      <>
        <ConfirmDialog />
        <div className="flex items-center gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="flex-1 text-xs">
                <RefreshCw className="size-3.5 mr-1.5" />
                Update Connection
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] p-6">
              {connectionStep === "choose"
                ? renderChooseStep("Update Connection Method", "Choose how you would like to re-authenticate and connect to the repository.")
                : renderFormContent()}
            </DialogContent>
          </Dialog>

          <Button
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            size="sm"
            variant="destructive"
            className="flex-1 text-xs font-semibold"
          >
            {isDisconnecting ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5 mr-1.5" />
            )}
            Disconnect Repo
          </Button>
        </div>
      </>
    );
  }

  if (isPendingOAuthSetup) {
    if (!canManage) return null;
    return (
      <Dialog open={open} onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConnectionStep("choose");
      }}>
        <DialogTrigger asChild>
          {trigger ?? (
            <Button className="w-full text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white animate-pulse">
              Complete GitHub Connection
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="sm:max-w-[500px] p-6">
          {connectionStep === "create-repo" ? renderCreateRepoStep() : connectionStep === "choose" ? renderChooseStep("Reconnect GitHub", "Sign in again or paste a token. Access stays Fairlx-wide.") : renderSelectRepoStep()}
        </DialogContent>
      </Dialog>
    );
  }

  if (!canManage) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) setConnectionStep("choose");
    }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            className={cn(
              "btn-connect-repo w-full text-xs font-semibold gap-1.5 [&_svg]:size-3.5",
              "bg-black text-white hover:bg-neutral-800 border-transparent",
              "dark:bg-blue-600 dark:text-white dark:hover:bg-blue-500 dark:border-transparent",
              "pitch-dark:bg-zinc-900 pitch-dark:text-white pitch-dark:hover:bg-zinc-800 pitch-dark:border pitch-dark:border-white/15"
            )}
          >
            <Github className="size-3.5 shrink-0" />
            <span>Connect Repository</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] p-6">
        {connectionStep === "choose"
          ? renderChooseStep("Connect GitHub Repository", "Sign in with GitHub once for all Fairlx projects, or paste a personal access token. Then pick a repository or create one.")
          : connectionStep === "select-repo"
          ? renderSelectRepoStep()
          : connectionStep === "create-repo"
          ? renderCreateRepoStep()
          : renderFormContent()}
      </DialogContent>
    </Dialog>
  );
};
