"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

import { FairlxAgentFaceEngine } from "./engine";
import type { AgentEmotion, AgentFaceAppearance, AgentFaceTheme, AgentGazeDirection, AgentMouthMode } from "./types";

import "./face.css";
import "./animations.css";

export type FairlxAgentFaceProps = {
  emotion?: AgentEmotion;
  gaze?: AgentGazeDirection;
  gazeProgress?: number;
  theme?: AgentFaceTheme;
  appearance?: AgentFaceAppearance;
  size?: number;
  tracking?: boolean;
  floating?: boolean;
  sound?: boolean;
  mouthMode?: AgentMouthMode;
  flat?: boolean;
  className?: string;
};

function appearanceFromTheme(theme?: string): AgentFaceAppearance {
  if (theme === "pitch-dark") return "pitch-dark";
  if (theme === "light") return "white";
  return "dark";
}

export function FairlxAgentFace({
  emotion = "idle",
  gaze = "neutral",
  gazeProgress = 0.5,
  theme = "theme-fairlx-blue",
  appearance,
  size = 240,
  tracking = true,
  floating = false,
  sound: _sound = false,
  mouthMode = "neon",
  flat,
  className,
}: FairlxAgentFaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<FairlxAgentFaceEngine | null>(null);
  const { resolvedTheme } = useTheme();
  const mode = appearance ?? appearanceFromTheme(resolvedTheme);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const engine = new FairlxAgentFaceEngine(root, {
      scale: 1,
      tracking,
      floating,
      flat: flat ?? size < 64,
    });
    engine.setEmotion(emotion, { silent: true });
    engine.setGazeDirection(gaze, gazeProgress);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // Mount once; live props sync below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setTracking(tracking);
  }, [tracking]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.floating = floating;
  }, [floating]);

  useEffect(() => {
    engineRef.current?.setEmotion(emotion);
  }, [emotion]);

  useEffect(() => {
    engineRef.current?.setGazeDirection(gaze, gazeProgress);
  }, [gaze, gazeProgress]);

  useEffect(() => {
    engineRef.current?.setMouthMode(mouthMode);
  }, [mouthMode]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "fairlx-agent-face-root",
        theme,
        `mode-${mode}`,
        size < 160 && "is-compact",
        gaze === "down" && "face-looking-down",
        gaze === "up" && "face-looking-up",
        className,
      )}
      style={{
        width: size,
        height: size,
        ["--face-box" as string]: `${size}px`,
        ["--face-scale" as string]: String(size / 240),
        ["--gaze-progress" as string]: String(gazeProgress),
      }}
      role="img"
      aria-label={`Fairlx agent face, ${emotion}`}
    >
      <div className="agent-stage-wrapper">
        <div
          className="agent-face-scaler"
          style={{
            transform: `translate(-50%, -50%) scale(${size / 240})`,
            transformOrigin: "center center",
          }}
        >
        <div
          className={cn(
            "fairlx-agent-face",
            `state-${emotion}`,
            gaze === "down" && "face-looking-down",
            gaze === "up" && "face-looking-up",
            floating && size >= 180 && "floating-agent",
          )}
        >
          <div className="agent-sphere-shadow" />
          <div className="agent-chassis">
            <div className="agent-sphere-volume" />
            <div className="agent-visor">
              <div className="visor-scanlines" />
              <div className="visor-grid" />
              <div className="visor-glare" />
              <div className="agent-orbit-scanner" />
              <div className="agent-particles-layer" />
              <div className="agent-face-rig">
                <div className="agent-screen-content">
                  <div className="eyes-container">
                    <div className="agent-eye agent-eye-left">
                      <div className="eye-glow-inner" />
                      <div className="eye-pupil-center" />
                      <div className="eye-iris-ring" />
                      <div className="eye-lid-shadow" />
                    </div>
                    <div className="agent-eye agent-eye-right">
                      <div className="eye-glow-inner" />
                      <div className="eye-pupil-center" />
                      <div className="eye-iris-ring" />
                      <div className="eye-lid-shadow" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="agent-sphere-specular" />
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

export default FairlxAgentFace;
