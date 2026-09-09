export const AGENT_EMOTIONS = [
  "idle",
  "thinking",
  "listening",
  "speaking",
  "happy",
  "focused",
  "searching",
  "reading",
  "error",
  "sleep",
  "wink",
  "curious",
] as const;

export type AgentEmotion = (typeof AGENT_EMOTIONS)[number];

export type AgentGazeDirection = "up" | "down" | "neutral";

export type AgentMouthMode = "neon" | "waveform" | "dots";

export type AgentFaceTheme =
  | "theme-fairlx-blue"
  | "theme-fairlx-success"
  | "theme-fairlx-warning"
  | "theme-fairlx-danger"
  | "theme-fairlx-accent"
  | "theme-fairlx-mono"
  | "theme-cyber-neon"
  | "theme-emerald-matrix"
  | "theme-solar-amber"
  | "theme-crimson-glitch"
  | "theme-obsidian-mono"
  | "theme-violet-aura";

export type AgentFaceAppearance = "white" | "dark" | "pitch-dark";

export const AGENT_FACE_THEMES: AgentFaceTheme[] = [
  "theme-fairlx-blue",
  "theme-fairlx-success",
  "theme-fairlx-warning",
  "theme-fairlx-danger",
  "theme-fairlx-accent",
  "theme-fairlx-mono",
  "theme-cyber-neon",
  "theme-emerald-matrix",
  "theme-solar-amber",
  "theme-crimson-glitch",
  "theme-obsidian-mono",
  "theme-violet-aura",
];

export function isAgentEmotion(value: string): value is AgentEmotion {
  return (AGENT_EMOTIONS as readonly string[]).includes(value);
}
