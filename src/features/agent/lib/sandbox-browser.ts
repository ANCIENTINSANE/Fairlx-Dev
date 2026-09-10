import type { SandboxDriver } from "./sandbox/types";
import { redactSecrets } from "./sandbox/types";

export type SessionArtifact = {
  id: string;
  kind: "screenshot" | "recording";
  path: string;
  mime: string;
  createdAt: string;
  note?: string;
};

const SCREENSHOT_PATH = "/tmp/fairlx-preview.png";
const RECORDING_PATH = "/tmp/fairlx-preview.webm";

/**
 * Screenshot with whatever headless browser the image already has. Downloading Chromium via
 * Playwright (~150 MB) is only allowed when `allowInstall` is set — never on the start path,
 * where it used to add minutes to every cold session.
 */
export function sandboxScreenshotShell(port: number, allowInstall = false): string {
  const url = `http://127.0.0.1:${port}`;
  return [
    `url=${JSON.stringify(url)}`,
    `shot=${JSON.stringify(SCREENSHOT_PATH)}`,
    `if command -v chromium >/dev/null 2>&1; then chromium --headless --disable-gpu --window-size=1280,720 --screenshot="$shot" "$url" && echo FAIRLX_SHOT_OK && exit 0; fi`,
    `if command -v google-chrome >/dev/null 2>&1; then google-chrome --headless --disable-gpu --window-size=1280,720 --screenshot="$shot" "$url" && echo FAIRLX_SHOT_OK && exit 0; fi`,
    `if command -v chromium-browser >/dev/null 2>&1; then chromium-browser --headless --disable-gpu --window-size=1280,720 --screenshot="$shot" "$url" && echo FAIRLX_SHOT_OK && exit 0; fi`,
    `if ls ~/.cache/ms-playwright/chromium*/chrome-linux/chrome >/dev/null 2>&1; then npx --yes playwright screenshot --browser chromium "$url" "$shot" && echo FAIRLX_SHOT_OK && exit 0; fi`,
    ...(allowInstall
      ? [
          `npx --yes playwright install chromium >/dev/null 2>&1 || true`,
          `npx --yes playwright screenshot --browser chromium "$url" "$shot" && echo FAIRLX_SHOT_OK && exit 0`,
        ]
      : []),
    `echo FAIRLX_SHOT_SKIP`,
    `exit 0`,
  ].join("\n");
}

export function sandboxRecordingShell(port: number): string {
  const url = `http://127.0.0.1:${port}`;
  return [
    `url=${JSON.stringify(url)}`,
    `out=${JSON.stringify(RECORDING_PATH)}`,
    `if command -v ffmpeg >/dev/null 2>&1; then echo FAIRLX_REC_SKIP; exit 0; fi`,
    `echo FAIRLX_REC_SKIP`,
  ].join("\n");
}

export async function captureSandboxPreview(params: {
  driver: SandboxDriver;
  sandboxId: string;
  port: number;
  /** Let Playwright download Chromium (slow). Off for session start; on for explicit browser tool calls. */
  allowInstall?: boolean;
}): Promise<{ artifacts: SessionArtifact[]; log: string }> {
  if (params.driver.kind === "stub") {
    return {
      artifacts: [],
      log: "Stub driver cannot capture a live browser screenshot.",
    };
  }
  const shot = await params.driver.exec(
    params.sandboxId,
    sandboxScreenshotShell(params.port, params.allowInstall === true),
    "/workspace",
  );
  const artifacts: SessionArtifact[] = [];
  if (/FAIRLX_SHOT_OK/.test(shot.stdout)) {
    artifacts.push({
      id: crypto.randomUUID(),
      kind: "screenshot",
      path: SCREENSHOT_PATH,
      mime: "image/png",
      createdAt: new Date().toISOString(),
      note: "Sandbox Chromium screenshot of the running app.",
    });
  }
  // Recording needs ffmpeg + a display; every image we ship skips it, so do not spend a
  // round-trip asking. Keep the helper exported for tooling that wants to probe explicitly.
  const log = redactSecrets(`${shot.stdout}\n${shot.stderr}`.trim());
  if (!artifacts.length) {
    return {
      artifacts: [],
      log: log || "No headless Chromium in this sandbox image. The Preview iframe is the in-app browser.",
    };
  }
  return { artifacts, log };
}

export async function readSandboxArtifactBase64(params: {
  driver: SandboxDriver;
  sandboxId: string;
  path: string;
}): Promise<string> {
  const result = await params.driver.exec(
    params.sandboxId,
    `python -c "import base64,pathlib; print(base64.b64encode(pathlib.Path(${JSON.stringify(params.path)}).read_bytes()).decode())"`,
    "/workspace",
  );
  if (result.exitCode !== 0) throw new Error(result.stderr || "Could not read sandbox artifact");
  return result.stdout.replace(/\s+/g, "");
}
