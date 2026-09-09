import { describe, expect, it, vi } from "vitest";

import { withIdempotency } from "./idempotency";
import type { McpRuntime } from "./types";

function runtime(overrides: Partial<McpRuntime> = {}): McpRuntime {
  return {
    getIdempotencyResult: vi.fn().mockResolvedValue(null),
    acquireIdempotencyLock: vi.fn().mockResolvedValue(true),
    recordIdempotency: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as McpRuntime;
}

describe("withIdempotency", () => {
  it("still runs the write when Redis reports the connection is closed", async () => {
    const closed = new Error("Connection is closed.");
    const rt = runtime({
      getIdempotencyResult: vi.fn().mockRejectedValue(closed),
      recordIdempotency: vi.fn().mockRejectedValue(closed),
    });
    const created = await withIdempotency(rt, "create-ppt-generator-project", "fairlx_project_create", async () => ({
      id: "proj_new",
    }));
    expect(created).toEqual({ id: "proj_new" });
  });

  it("returns a stored result when the idempotency store is healthy", async () => {
    const rt = runtime({
      getIdempotencyResult: vi.fn().mockResolvedValue({ id: "proj_existing" }),
    });
    const fn = vi.fn();
    const created = await withIdempotency(rt, "same-key", "fairlx_project_create", fn);
    expect(created).toEqual({ id: "proj_existing" });
    expect(fn).not.toHaveBeenCalled();
  });
});
