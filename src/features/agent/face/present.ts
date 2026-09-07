import type { AgentFaceMood } from "../lib/agent-face-mood";
import type { AgentEmotion, AgentGazeDirection } from "./types";

/** Map product run mood onto the studio visor emotion + gaze. */
export function presentAgentFace(mood: AgentFaceMood): { emotion: AgentEmotion; gaze: AgentGazeDirection } {
  switch (mood) {
    case "lookDown":
      return { emotion: "idle", gaze: "down" };
    case "listening":
      return { emotion: "listening", gaze: "up" };
    case "thinking":
      return { emotion: "thinking", gaze: "up" };
    case "coding":
      return { emotion: "focused", gaze: "neutral" };
    case "happy":
      return { emotion: "happy", gaze: "up" };
    case "ask":
      return { emotion: "curious", gaze: "up" };
    case "error":
      return { emotion: "error", gaze: "neutral" };
    default:
      return { emotion: "idle", gaze: "up" };
  }
}
