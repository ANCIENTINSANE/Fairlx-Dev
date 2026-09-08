import { MOUTH_PATHS, MOUTH_TALK_FRAMES } from "./mouth-paths";
import { AGENT_EMOTIONS, isAgentEmotion, type AgentEmotion, type AgentGazeDirection, type AgentMouthMode } from "./types";

type Vec2 = { x: number; y: number };

export class FairlxAgentFaceEngine {
  currentEmotion: AgentEmotion = "idle";
  gazeDirection: AgentGazeDirection = "neutral";
  isTrackingEnabled = true;
  isAutoBlinkEnabled = true;
  isCuriousWanderEnabled = true;
  headScale = 1;
  floating = false;
  private readonly flat: boolean;

  private readonly container: HTMLElement;
  private readonly faceEl: HTMLElement | null;
  private readonly glareEl: HTMLElement | null;
  private readonly eyesContainer: HTMLElement | null;
  private readonly mouthArea: HTMLElement | null;
  private readonly mouthPath: SVGPathElement | null;
  private readonly waveBars: HTMLElement[];
  private readonly particlesLayer: HTMLElement | null;

  private typingGazeX = 0;
  private eyeOffset: Vec2 = { x: 0, y: 0 };
  private targetEyeOffset: Vec2 = { x: 0, y: 0 };

  private wanderEyeOffset: Vec2 = { x: 0, y: 0 };
  private wanderTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastUserInteractionTime = 0;

  private readonly lerpFactor = 0.08;

  private raf = 0;
  private speechAnimInterval: ReturnType<typeof setInterval> | null = null;
  private blinkTimeout: ReturnType<typeof setTimeout> | null = null;
  private particleInterval: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(container: HTMLElement, options?: { scale?: number; tracking?: boolean; floating?: boolean; flat?: boolean }) {
    this.container = container;
    this.headScale = options?.scale ?? 1;
    this.isTrackingEnabled = options?.tracking !== false && !options?.flat;
    this.floating = Boolean(options?.floating) && !options?.flat;
    this.flat = Boolean(options?.flat);
    this.faceEl = container.querySelector(".fairlx-agent-face");
    this.glareEl = container.querySelector(".visor-glare");
    this.eyesContainer = container.querySelector(".eyes-container");
    this.mouthArea = container.querySelector(".agent-mouth-area");
    this.mouthPath = container.querySelector(".mouth-path");
    this.waveBars = Array.from(container.querySelectorAll(".wave-bar"));
    this.particlesLayer = container.querySelector(".agent-particles-layer");
    this.bindEvents();
    if (!this.flat) this.startLoop();
    this.scheduleNextBlink();
    this.scheduleNextWander();
    this.setEmotion("idle", { silent: true });
  }

  private bindEvents() {
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("touchmove", this.onTouchMove, { passive: true });
    document.addEventListener("mouseleave", this.onMouseLeave);
  }

  private onMouseMove = (event: MouseEvent) => {
    this.lastUserInteractionTime = Date.now();
    if (!this.isTrackingEnabled || !this.faceEl) return;
    const rect = this.faceEl.getBoundingClientRect();
    const deltaX = (event.clientX - (rect.left + rect.width / 2)) / (window.innerWidth / 2);
    const deltaY = (event.clientY - (rect.top + rect.height / 2)) / (window.innerHeight / 2);
    const clampedX = Math.max(-1, Math.min(1, deltaX));
    const clampedY = Math.max(-1, Math.min(1, deltaY));
    this.targetEyeOffset.x = clampedX * 10;
    this.targetEyeOffset.y = clampedY * 8;
  };

  private onTouchMove = (event: TouchEvent) => {
    this.lastUserInteractionTime = Date.now();
    if (!this.isTrackingEnabled || !event.touches[0] || !this.faceEl) return;
    const touch = event.touches[0];
    const rect = this.faceEl.getBoundingClientRect();
    const clampedX = Math.max(-1, Math.min(1, (touch.clientX - (rect.left + rect.width / 2)) / 200));
    const clampedY = Math.max(-1, Math.min(1, (touch.clientY - (rect.top + rect.height / 2)) / 200));
    this.targetEyeOffset.x = clampedX * 8;
    this.targetEyeOffset.y = clampedY * 6;
  };

  private onMouseLeave = () => {
    this.targetEyeOffset.x = 0;
    this.targetEyeOffset.y = 0;
    this.lastUserInteractionTime = 0;
  };

  private startLoop() {
    const tick = () => {
      if (this.destroyed) return;
      let eyeX = this.targetEyeOffset.x;
      let eyeY = this.targetEyeOffset.y;

      const isUserTracking = this.isTrackingEnabled && (Date.now() - this.lastUserInteractionTime < 1400);
      const cssOwnsGaze =
        !isUserTracking &&
        this.gazeDirection !== "down" &&
        this.currentEmotion !== "sleep";

      if (this.gazeDirection === "down") {
        eyeY = 28;
        eyeX = this.typingGazeX + this.targetEyeOffset.x * 0.15;
      } else if (!cssOwnsGaze && this.gazeDirection === "up") {
        eyeY = -12;
        eyeX = this.targetEyeOffset.x * 0.35;
      } else if (!cssOwnsGaze) {
        eyeX = this.targetEyeOffset.x;
        eyeY = this.targetEyeOffset.y;
      }

      this.eyeOffset.x += (eyeX - this.eyeOffset.x) * this.lerpFactor;
      this.eyeOffset.y += (eyeY - this.eyeOffset.y) * this.lerpFactor;

      const floatY = this.floating ? Math.sin(Date.now() * 0.0015) * 6 : 0;
      if (this.faceEl) {
        this.faceEl.style.transform = `scale(${this.headScale}) translateY(${floatY.toFixed(2)}px)`;
      }
      if (this.eyesContainer) {
        if (cssOwnsGaze) {
          this.eyesContainer.style.transform = "";
        } else {
          this.eyesContainer.style.transform = `translate3d(${this.eyeOffset.x.toFixed(2)}px, ${this.eyeOffset.y.toFixed(2)}px, 18px)`;
        }
      }
      if (this.mouthArea) {
        this.mouthArea.style.transform = `translate3d(${(this.eyeOffset.x * 0.7).toFixed(2)}px, ${(this.eyeOffset.y * 0.7).toFixed(2)}px, 15px)`;
      }
      if (this.glareEl) {
        if (cssOwnsGaze) {
          this.glareEl.style.transform = "";
        } else {
          this.glareEl.style.transform = `translate3d(${(-this.eyeOffset.x * 1.5).toFixed(1)}px, ${(-this.eyeOffset.y * 1.5).toFixed(1)}px, 0px)`;
        }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  setGazeDirection(direction: AgentGazeDirection, progress = 0.5) {
    this.gazeDirection = direction;
    this.container.classList.remove("face-looking-down", "face-looking-up");
    this.faceEl?.classList.remove("face-looking-down", "face-looking-up");
    this.container.style.setProperty("--gaze-progress", String(progress));
    this.faceEl?.style.setProperty("--gaze-progress", String(progress));
    if (direction === "down") {
      this.container.classList.add("face-looking-down");
      this.faceEl?.classList.add("face-looking-down");
      this.wanderEyeOffset = { x: 0, y: 0 };
      this.typingGazeX = (progress - 0.5) * 28;
    } else if (direction === "up") {
      this.container.classList.add("face-looking-up");
      this.faceEl?.classList.add("face-looking-up");
      this.typingGazeX = 0;
    } else {
      this.typingGazeX = 0;
    }
  }

  setEmotion(emotion: AgentEmotion, options?: { silent?: boolean }) {
    if (!isAgentEmotion(emotion)) return;
    if (this.currentEmotion === "speaking" && emotion !== "speaking") this.stopSpeechAnimation();
    AGENT_EMOTIONS.forEach((item) => {
      this.container.classList.remove(`state-${item}`);
      this.faceEl?.classList.remove(`state-${item}`);
    });
    this.currentEmotion = emotion;
    this.container.classList.add(`state-${emotion}`);
    this.faceEl?.classList.add(`state-${emotion}`);
    if (this.mouthPath && MOUTH_PATHS[emotion]) this.mouthPath.setAttribute("d", MOUTH_PATHS[emotion]);
    if (options?.silent) {
      if (emotion !== "thinking") this.stopParticleStream();
      return;
    }
    switch (emotion) {
      case "idle":
        this.stopParticleStream();
        this.resetWaveform();
        break;
      case "thinking":
        this.startParticleStream();
        break;
      case "listening":
        this.stopParticleStream();
        break;
      case "speaking":
        this.stopParticleStream();
        this.simulateSpeech(2800);
        break;
      case "happy":
      case "focused":
      case "searching":
      case "reading":
      case "error":
        this.stopParticleStream();
        break;
      case "sleep":
        this.stopParticleStream();
        this.resetWaveform();
        break;
      case "wink":
      case "curious":
        this.stopParticleStream();
        break;
    }
  }

  setMouthMode(mode: AgentMouthMode) {
    this.container.classList.remove("mouth-mode-waveform", "mouth-mode-dots");
    if (mode === "waveform") this.container.classList.add("mouth-mode-waveform");
    if (mode === "dots") this.container.classList.add("mouth-mode-dots");
  }

  setTracking(enabled: boolean) {
    this.isTrackingEnabled = enabled && !this.flat;
    if (!this.isTrackingEnabled) this.onMouseLeave();
  }

  setHeadScale(scale: number) {
    this.headScale = scale;
  }

  setAutoBlink(enabled: boolean) {
    this.isAutoBlinkEnabled = enabled;
    if (enabled) this.scheduleNextBlink();
    else if (this.blinkTimeout) {
      clearTimeout(this.blinkTimeout);
      this.blinkTimeout = null;
    }
  }

  setCuriousWander(enabled: boolean) {
    this.isCuriousWanderEnabled = enabled;
    if (enabled) {
      this.scheduleNextWander();
    } else if (this.wanderTimeout) {
      clearTimeout(this.wanderTimeout);
      this.wanderTimeout = null;
      this.wanderEyeOffset = { x: 0, y: 0 };
    }
  }

  triggerBlink() {
    if (this.currentEmotion === "sleep") return;
    this.container.classList.add("is-blinking");
    window.setTimeout(() => this.container.classList.remove("is-blinking"), 360);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("touchmove", this.onTouchMove);
    document.removeEventListener("mouseleave", this.onMouseLeave);
    this.stopSpeechAnimation();
    this.stopParticleStream();
    if (this.blinkTimeout) clearTimeout(this.blinkTimeout);
    if (this.wanderTimeout) clearTimeout(this.wanderTimeout);
  }

  private scheduleNextBlink() {
    if (!this.isAutoBlinkEnabled || this.destroyed) return;
    const delay = 4500 + Math.random() * 5000;
    this.blinkTimeout = setTimeout(() => {
      this.triggerBlink();
      // 20% chance of double flutter blink
      if (Math.random() < 0.2) {
        setTimeout(() => {
          if (!this.destroyed) this.triggerBlink();
        }, 380);
      }
      this.scheduleNextBlink();
    }, delay);
  }

  private scheduleNextWander() {
    if (!this.isCuriousWanderEnabled || this.destroyed) return;
    const interval = 2400 + Math.random() * 2600;
    this.wanderTimeout = setTimeout(() => {
      this.pickCuriousGaze();
      this.scheduleNextWander();
    }, interval);
  }

  private pickCuriousGaze() {
    if (this.destroyed || !this.isCuriousWanderEnabled) return;
    // When writing in chat box or sleeping, stay locked / calm
    if (this.gazeDirection === "down" || this.currentEmotion === "sleep" || this.currentEmotion === "idle") {
      this.wanderEyeOffset = { x: 0, y: 0 };
      return;
    }

    // Organic inquisitive eye glances around the environment (without head rotation)
    const eyePoses = [
      { x: -14, y: -10 },
      { x: 14, y: -8 },
      { x: 0, y: -15 },
      { x: 12, y: 10 },
      { x: -12, y: 10 },
      { x: -6, y: -4 },
      { x: 6, y: -4 },
      { x: 0, y: 0 },
    ];

    const chosen = eyePoses[Math.floor(Math.random() * eyePoses.length)];
    this.wanderEyeOffset = { x: chosen.x, y: chosen.y };

    // Occasionally do a quick micro-blink when shifting gaze
    if (Math.random() < 0.35) {
      setTimeout(() => {
        if (!this.destroyed) this.triggerBlink();
      }, 150);
    }
  }

  private simulateSpeech(durationMs = 2800) {
    this.stopSpeechAnimation();
    let frameIdx = 0;
    this.speechAnimInterval = setInterval(() => {
      frameIdx = (frameIdx + 1) % MOUTH_TALK_FRAMES.length;
      if (this.mouthPath && this.currentEmotion === "speaking") {
        this.mouthPath.setAttribute("d", MOUTH_TALK_FRAMES[frameIdx]);
      }
      this.waveBars.forEach((bar) => {
        const h = 6 + Math.random() * 22;
        bar.style.height = `${h}px`;
      });
    }, 120);
    window.setTimeout(() => {
      this.stopSpeechAnimation();
      this.resetWaveform();
      if (this.currentEmotion === "speaking" && this.mouthPath) {
        this.mouthPath.setAttribute("d", MOUTH_PATHS.speaking);
      }
    }, durationMs);
  }

  private stopSpeechAnimation() {
    if (this.speechAnimInterval) {
      clearInterval(this.speechAnimInterval);
      this.speechAnimInterval = null;
    }
  }

  private resetWaveform() {
    this.waveBars.forEach((bar) => {
      bar.style.height = "10px";
    });
  }

  private startParticleStream() {
    if (this.particleInterval) return;
    this.particleInterval = setInterval(() => {
      if (!this.particlesLayer) return;
      const p = document.createElement("div");
      p.className = "particle";
      const size = 3 + Math.random() * 5;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.left = `${25 + Math.random() * 50}%`;
      p.style.bottom = `${25 + Math.random() * 25}%`;
      p.style.animation = `float-particle ${1.2 + Math.random() * 0.8}s ease-out forwards`;
      this.particlesLayer.appendChild(p);
      window.setTimeout(() => p.remove(), 2000);
    }, 180);
  }

  private stopParticleStream() {
    if (this.particleInterval) {
      clearInterval(this.particleInterval);
      this.particleInterval = null;
    }
    if (this.particlesLayer) this.particlesLayer.innerHTML = "";
  }
}
