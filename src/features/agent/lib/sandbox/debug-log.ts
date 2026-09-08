import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const INGEST = "http://127.0.0.1:7286/ingest/db109762-469d-4037-9e78-0ad4912b118d";
const LOG_PATH = "/Users/surendra/Documents/CODE/Fairlx-Dev-Env/.cursor/debug-18d70c.log";

export function agentDebugLog(payload: {
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
  runId?: string;
}) {
  const body = JSON.stringify({
    sessionId: "18d70c",
    timestamp: Date.now(),
    runId: payload.runId ?? "post-fix",
    hypothesisId: payload.hypothesisId,
    location: payload.location,
    message: payload.message,
    data: payload.data ?? {},
  });
  // #region agent log
  fetch(INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "18d70c" },
    body,
  }).catch(() => {});
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, `${body}\n`);
  } catch {
    /* ignore */
  }
  // #endregion
}
