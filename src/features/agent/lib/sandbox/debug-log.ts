export function agentDebugLog(_payload: {
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
  runId?: string;
}) {
  // Debug session leftover. Keep the call sites, but never write files or
  // POST to a local ingest URL in production builds.
}
