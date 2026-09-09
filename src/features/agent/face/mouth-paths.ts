import type { AgentEmotion } from "./types";

export const MOUTH_PATHS: Record<AgentEmotion, string> = {
  idle: "M 14 12 Q 52 30 90 12",
  happy: "M 10 10 Q 52 34 94 10",
  speaking: "M 16 14 Q 52 28 88 14",
  thinking: "M 24 18 Q 52 14 80 18",
  listening: "M 16 16 Q 34 10 52 16 Q 70 22 88 16",
  focused: "M 24 18 L 80 18",
  searching: "M 22 16 Q 52 12 82 16",
  reading: "M 24 18 Q 52 16 80 20",
  error: "M 16 22 L 34 14 L 52 22 L 70 14 L 88 22",
  sleep: "M 28 18 L 76 18",
  wink: "M 18 20 Q 52 24 86 12",
  curious: "M 41 16 A 11 11 0 1 0 63 16 A 11 11 0 1 0 41 16",
};

export const MOUTH_TALK_FRAMES = [
  "M 20 12 Q 52 2 84 12 Q 52 32 20 12 Z",
  "M 22 14 Q 52 6 82 14 Q 52 26 22 14 Z",
  "M 20 16 Q 52 24 84 16",
];
