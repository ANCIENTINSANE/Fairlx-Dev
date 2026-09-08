"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Loader2,
  Mic,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { useGetAgentContext } from "../api/use-agent-context";
import { useGetAgentHarness } from "../api/use-agent-harness";
import { useGetPersonalAgent } from "../api/use-personal-agent";
import { agentRunQueryKey, useCreateAgentRun, useStopAgentRun } from "../api/use-agent-runs";
import { useTranscribeAudio } from "../api/use-transcribe-audio";
import { AGENT_RUNS_QUERY_KEY } from "../constants";
import { buildOptimisticAgentRun, navigateToAgentRun, newAgentRunId } from "../lib/optimistic-run";
import { chipKey, composeUserPrompt, isPersonalSessionMode } from "../lib/session-context";
import { profileIsTrained } from "../lib/personal-agent-status";
import { typingGazeProgress } from "../lib/typing-gaze";
import { countWorkspaceProjects, getQuickActions } from "../lib/quick-actions";
import { MAX_VOICE_MS, audioFilenameForMime, pickRecorderMimeType, voiceInputSupported } from "../lib/voice-input";
import type { AgentContextChip, AgentRun, AgentSessionMode } from "../types";
import { AgentPlusMenu, ContextChips } from "./agent-plus-menu";
import { AgentScopeBar } from "./agent-scope-bar";
import { AgentModeSelector } from "./agent-mode-selector";
import { AgentPermissionPicker } from "./agent-permission-picker";
import { ModelPicker } from "./model-picker";
import { McpBarButton } from "./mcp-servers-card";
import { PersonalAgentSetup } from "./personal-agent-setup";
import { AgentContextMeter } from "./agent-context-meter";

/** Short descriptions shown under each suggestion card title. */
const QUICK_ACTION_DESCRIPTIONS: Record<string, string> = {
  "Plan new feature": "Propose a feature with user stories and sprint plan",
  "Create project": "Turn an idea into a well-scoped project",
  "Fix a bug": "Investigate and resolve issues in your codebase",
  "Refactor code": "Propose a focused refactor for cleaner architecture",
  "Write tests": "Generate comprehensive tests for your code",
  "Add docs": "Draft documentation for your project",
};

function autosize(el: HTMLTextAreaElement, min = 56) {
  el.style.height = "auto";
  el.style.height = `${Math.min(Math.max(el.scrollHeight, min), 180)}px`;
}

export function AgentCommandInput({
  run,
  showQuickActions = true,
  placeholder = "Plan, Build, / for skills, @ for context",
  variant = "create",
  disabled = false,
  submitting = false,
  onFollowUp,
  onStop,
  isStopping = false,
  workspaceId,
  projectId,
  compact = false,
  onCreated,
}: {
  run?: AgentRun;
  showQuickActions?: boolean;
  placeholder?: string;
  variant?: "create" | "followup";
  disabled?: boolean;
  submitting?: boolean;
  onFollowUp?: (content: string) => void;
  onStop?: () => void;
  isStopping?: boolean;
  workspaceId?: string;
  projectId?: string;
  compact?: boolean;
  onCreated?: (run: AgentRun) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: harness } = useGetAgentHarness();
  const { data: context } = useGetAgentContext();
  const { data: personal } = useGetPersonalAgent();
  const createRun = useCreateAgentRun();
  const stopRunMutation = useStopAgentRun();
  const transcribeAudio = useTranscribeAudio();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  const [chips, setChips] = useState<AgentContextChip[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [gazeProgress, setGazeProgress] = useState(0.12);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(workspaceId ?? null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId ?? null);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const maxTimerRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);
  const updateTypingGaze = () => {
    const el = textareaRef.current;
    if (!el) return;
    const style = window.getComputedStyle(el);
    setGazeProgress(
      typingGazeProgress({
        value: el.value,
        caret: el.selectionEnd ?? el.value.length,
        widthPx: el.clientWidth,
        fontSizePx: parseFloat(style.fontSize) || 16,
        paddingXPx: (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0),
      }),
    );
  };
  const minHeight = compact ? 40 : 56;
  const resetHeight = compact ? "40px" : "56px";

  useEffect(() => {
    if (variant !== "create") return;
    router.prefetch("/agent/workflow");
  }, [router, variant]);

  useEffect(() => {
    setSelectedWorkspaceId(workspaceId ?? null);
  }, [workspaceId]);

  useEffect(() => {
    setSelectedProjectId(projectId ?? null);
  }, [projectId]);

  const isRunning = run?.status === "running";
  const stopping = isStopping || stopRunMutation.isPending;
  const showStop = isRunning || run?.status === "awaiting_confirmation" || run?.status === "awaiting_question" || stopping;
  const busy = submitting || createRun.isPending;
  const voiceBusy = busy || isTranscribing;
  const canSend = Boolean(prompt.trim()) && !busy && !disabled;
  const sessionMode = (harness?.settings.sessionMode as AgentSessionMode) || "agent";
  const personalUntrained =
    isPersonalSessionMode(sessionMode) &&
    !profileIsTrained(personal?.profile) &&
    run?.kind !== "training";
  const inputPlaceholder = run?.kind === "training"
    ? "Or write your own answer"
    : isPersonalSessionMode(sessionMode)
      ? "Command your Personal Agent — plan, build, test, review"
      : placeholder;

  const workspaces = useMemo(() => context?.workspaces ?? [], [context?.workspaces]);
  const activeWorkspaceId =
    selectedWorkspaceId ||
    run?.workspaceId ||
    workspaceId ||
    harness?.settings.defaultWorkspaceId ||
    workspaces[0]?.id;

  const projectCount = useMemo(
    () => countWorkspaceProjects(context?.projects, activeWorkspaceId),
    [context?.projects, activeWorkspaceId]
  );
  const hasProjects = context ? projectCount > 0 : true;
  const activeProjectId = hasProjects
    ? selectedProjectId || run?.projectId || projectId || harness?.settings.defaultProjectId
    : undefined;

  const quickActions = useMemo(
    () => getQuickActions(hasProjects),
    [hasProjects]
  );

  const handleStop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (stopping) return;
    if (onStop) {
      onStop();
    } else if (run?.id) {
      stopRunMutation.mutate({ runId: run.id });
    }
  };

  const stopMicTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const clearMaxTimer = () => {
    if (maxTimerRef.current) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  };

  const applyTranscript = (text: string) => {
    const next = text.trim();
    if (!next) return;
    setPrompt((prev) => (prev.trim() ? `${prev.trimEnd()} ${next}` : next));
    requestAnimationFrame(() => {
      if (textareaRef.current) autosize(textareaRef.current, minHeight);
    });
  };

  const finishRecording = async (blob: Blob) => {
    if (unmountedRef.current) return;
    if (blob.size < 256) {
      toast.error("Didn't catch any audio. Hold the mic a moment longer.");
      return;
    }
    const mime = blob.type || "audio/webm";
    const file = new File([blob], audioFilenameForMime(mime), { type: mime.split(";")[0] || "audio/webm" });
    setIsTranscribing(true);
    try {
      const text = await transcribeAudio.mutateAsync(file);
      if (!unmountedRef.current) applyTranscript(text);
    } finally {
      if (!unmountedRef.current) setIsTranscribing(false);
    }
  };

  const stopVoiceInput = () => {
    clearMaxTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      stopMicTracks();
    }
    setIsListening(false);
  };

  const startVoiceInput = async () => {
    if (!voiceInputSupported()) {
      toast.error("Voice input isn't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = pickRecorderMimeType();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        clearMaxTimer();
        stopMicTracks();
        setIsListening(false);
        toast.error("Microphone recording failed.");
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        recorderRef.current = null;
        stopMicTracks();
        if (unmountedRef.current) return;
        void finishRecording(blob);
      };
      recorder.start();
      setIsListening(true);
      maxTimerRef.current = window.setTimeout(() => stopVoiceInput(), MAX_VOICE_MS);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        toast.error("Allow microphone access to use voice input.");
        return;
      }
      toast.error("Couldn't start the microphone.");
    }
  };

  const toggleVoiceInput = () => {
    if (voiceBusy) return;
    if (isListening) {
      stopVoiceInput();
      return;
    }
    void startVoiceInput();
  };

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      clearMaxTimer();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      stopMicTracks();
    };
  }, []);

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || busy || disabled || personalUntrained) return;
    const content = composeUserPrompt(trimmed, chips, sessionMode);
    if (variant === "followup") {
      onFollowUp?.(content);
      setPrompt("");
      setChips([]);
      if (textareaRef.current) textareaRef.current.style.height = resetHeight;
      return;
    }
    const targetWorkspaceId =
      activeWorkspaceId || workspaceId || harness?.settings.defaultWorkspaceId || context?.workspaces[0]?.id;
    const targetProjectId = hasProjects
      ? selectedProjectId || run?.projectId || projectId || harness?.settings.defaultProjectId
      : undefined;

    const runId = newAgentRunId();
    const optimistic = buildOptimisticAgentRun({
      id: runId,
      prompt: content,
      workspaceId: targetWorkspaceId,
      projectId: targetProjectId,
      mode: harness?.settings.mode,
    });
    queryClient.setQueryData(agentRunQueryKey(runId), optimistic);
    queryClient.setQueryData(AGENT_RUNS_QUERY_KEY, (current: AgentRun[] | undefined) => {
      if (!Array.isArray(current)) return [optimistic];
      return [optimistic, ...current.filter((item) => item.id !== runId)];
    });
    setPrompt("");
    setChips([]);
    if (textareaRef.current) textareaRef.current.style.height = resetHeight;

    if (onCreated) {
      onCreated(optimistic);
    } else {
      navigateToAgentRun(router, runId);
    }

    createRun.mutate(
      {
        json: {
          id: runId,
          prompt: content,
          workspaceId: targetWorkspaceId,
          projectId: targetProjectId,
        },
      },
      {
        onError: () => {
          queryClient.removeQueries({ queryKey: agentRunQueryKey(runId) });
          queryClient.setQueryData(AGENT_RUNS_QUERY_KEY, (current: AgentRun[] | undefined) => {
            if (!Array.isArray(current)) return current;
            return current.filter((item) => item.id !== runId);
          });
          if (!onCreated) router.replace("/agent/dashboard");
        },
      },
    );
  };

  const showSuggestions = showQuickActions && !personalUntrained && !suggestionsDismissed && variant === "create";

  return (
    <div className={cn(showQuickActions && variant === "create" ? "space-y-4" : "w-full")}>
      <AgentScopeBar
        run={run}
        composerTyping={composerFocused || prompt.length > 0}
        composerListening={isListening}
        composerGazeProgress={gazeProgress}
        defaultWorkspaceId={workspaceId}
        defaultProjectId={projectId}
        onScopeChange={(wsId, projId) => {
          setSelectedWorkspaceId(wsId);
          setSelectedProjectId(projId ?? null);
        }}
      />
      <form
        className={cn(
          "border border-border/80 bg-card/70 dark:bg-zinc-900/70 backdrop-blur-sm shadow-xs flex flex-col transition-all focus-within:ring-1 focus-within:ring-border focus-within:border-foreground/30",
          compact ? "rounded-xl" : "rounded-2xl",
        )}
        onSubmit={(event) => {
          event.preventDefault();
          if (!personalUntrained) submit(prompt);
        }}
      >
        {personalUntrained ? (
          <div className="px-4 pt-4 pb-3">
            <PersonalAgentSetup compact />
          </div>
        ) : (
          <ContextChips
            chips={chips}
            onRemove={(chip) => setChips((current) => current.filter((item) => chipKey(item) !== chipKey(chip)))}
          />
        )}
        {personalUntrained ? null : (
          <>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                autosize(event.currentTarget, minHeight);
                updateTypingGaze();
              }}
              onFocus={() => {
                setComposerFocused(true);
                requestAnimationFrame(updateTypingGaze);
              }}
              onBlur={() => setComposerFocused(false)}
              onClick={updateTypingGaze}
              onKeyUp={updateTypingGaze}
              onSelect={updateTypingGaze}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit(prompt);
                }
              }}
              placeholder={inputPlaceholder}
              rows={1}
              disabled={busy}
              className={cn(
                "w-full bg-transparent text-foreground leading-relaxed resize-none focus:outline-none placeholder:text-muted-foreground/60 max-h-44 custom-scrollbar",
                compact
                  ? "text-[13px] px-3 pt-2.5 pb-1.5 min-h-[40px]"
                  : "text-[14px] sm:text-[15px] px-4 pt-3.5 pb-2 min-h-[58px]",
              )}
            />
            <div className={cn("flex items-center justify-between pt-0.5 select-none", compact ? "px-2 pb-2" : "px-3 pb-2.5")}>
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <AgentModeSelector />
                <AgentPermissionPicker />
                <ModelPicker variant="subtle" runModelId={run?.modelId} />
                <McpBarButton />
              </div>

              <div className="flex items-center gap-1.5">
                <AgentContextMeter
                  run={run}
                  draftPrompt={prompt}
                  chips={chips}
                  workspaceId={activeWorkspaceId}
                  projectId={activeProjectId}
                />
                <AgentPlusMenu
                  chips={chips}
                  onAdd={(chip) =>
                    setChips((current) => [...current.filter((item) => chipKey(item) !== chipKey(chip)), chip])
                  }
                  triggerVariant="paperclip"
                  align="end"
                />
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  disabled={voiceBusy}
                  className={cn(
                    "size-7 rounded-full flex items-center justify-center transition-all cursor-pointer",
                    isListening
                      ? "bg-red-500 text-white animate-pulse"
                      : "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900 hover:opacity-90 shadow-2xs",
                    voiceBusy && "opacity-60 cursor-not-allowed"
                  )}
                  title={
                    isTranscribing
                      ? "Transcribing…"
                      : isListening
                        ? "Listening… click to stop"
                        : "Voice input"
                  }
                >
                  {isTranscribing ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}
                </button>
                {showStop ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    disabled={stopping}
                    className={cn(
                      "relative size-8 rounded-full flex items-center justify-center transition-all shadow-2xs group cursor-pointer",
                      "bg-destructive text-destructive-foreground hover:bg-destructive/90 border border-destructive",
                      stopping && "opacity-60 cursor-not-allowed"
                    )}
                    title={stopping ? "Stopping..." : "Stop all agents"}
                  >
                    <svg
                      className="absolute inset-0 size-full animate-spin text-destructive-foreground/70"
                      viewBox="0 0 28 28"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="14"
                        cy="14"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <circle
                        className="opacity-85"
                        cx="14"
                        cy="14"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeDasharray="62.83"
                        strokeDashoffset="44"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="relative z-10 size-2.5 rounded-[1.5px] bg-destructive-foreground transition-transform group-hover:scale-90" />
                  </button>
                ) : canSend || busy ? (
                  <button
                    type="submit"
                    disabled={!canSend}
                    className={cn(
                      "size-7 rounded-full flex items-center justify-center transition-colors shadow-2xs cursor-pointer",
                      canSend
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "bg-muted text-muted-foreground cursor-default"
                    )}
                    title="Send"
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
                  </button>
                ) : null}
              </div>
            </div>
          </>
        )}
        {personalUntrained ? (
          <div className="flex items-center px-3 pb-2.5">
            <AgentModeSelector />
          </div>
        ) : null}
      </form>

      {/* Linear-inspired suggestion cards */}
      {showSuggestions ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-sm font-medium text-foreground">
              Get started with some examples
            </p>
            <button
              type="button"
              onClick={() => setSuggestionsDismissed(true)}
              className="size-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label="Dismiss suggestions"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className={cn(
            "grid gap-3",
            compact ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-3",
          )}>
            {quickActions.slice(0, compact ? 4 : 3).map((action) => {
              const Icon = action.icon;
              const description = QUICK_ACTION_DESCRIPTIONS[action.label] ?? action.prompt.slice(0, 60);
              return (
                <button
                  key={action.label}
                  type="button"
                  disabled={busy}
                  onClick={() => submit(action.prompt)}
                  className={cn(
                    "group text-left rounded-xl border border-border/80 bg-card hover:bg-muted/40 hover:border-border",
                    "p-4 transition-all duration-200 shadow-sm hover:shadow-md",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    "disabled:opacity-60 disabled:pointer-events-none",
                  )}
                >
                  <Icon className="size-4 text-muted-foreground group-hover:text-foreground transition-colors mb-3" />
                  <p className="text-sm font-semibold text-foreground leading-tight">
                    {action.label}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-1.5">
                    {description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

