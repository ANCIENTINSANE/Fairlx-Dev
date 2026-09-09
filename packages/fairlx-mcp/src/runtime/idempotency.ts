import type { McpRuntime } from "./types";

export async function withIdempotency<T>(
  runtime: McpRuntime,
  idempotencyKey: string | undefined,
  tool: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!idempotencyKey) {
    return fn();
  }
  const eventKey = `mcp:${tool}:${idempotencyKey}`;
  try {
    const existing = await runtime.getIdempotencyResult(eventKey);
    if (existing !== null && existing !== undefined) {
      return existing as T;
    }
  } catch {
    // Redis/Appwrite idempotency store is optional. Create anyway.
  }
  let locked = true;
  try {
    locked = await runtime.acquireIdempotencyLock(eventKey, { tool });
  } catch {
    locked = true;
  }
  if (!locked) {
    try {
      const again = await runtime.getIdempotencyResult(eventKey);
      if (again !== null && again !== undefined) {
        return again as T;
      }
    } catch {
      // fall through to a lock-held error
    }
    throw new Error("Idempotency lock held for this key; retry shortly");
  }
  const result = await fn();
  try {
    await runtime.recordIdempotency(eventKey, result);
  } catch {
    // The write already succeeded — do not fail the tool because Redis closed.
  }
  return result;
}
