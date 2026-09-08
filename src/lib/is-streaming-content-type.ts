/**
 * Content types whose bodies must not be fully buffered by middleware.
 * Cloning and awaiting `.text()` on these responses holds the HTTP response
 * until the producer finishes — which makes progress streams look stuck,
 * then jump to 100%.
 */
export function isStreamingContentType(contentType: string | null | undefined): boolean {
  const type = (contentType ?? "").toLowerCase();
  return (
    type.includes("text/event-stream") ||
    type.includes("text/plain") ||
    type.includes("application/octet-stream") ||
    type.includes("application/x-ndjson") ||
    type.includes("application/ndjson")
  );
}
