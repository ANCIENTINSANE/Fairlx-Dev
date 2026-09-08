import { describe, expect, it } from "vitest";

import { describeCodingPreview, isStubPreviewUrl } from "./sandbox-preview";

describe("sandbox preview", () => {
  it("treats stub.fairlx.local as not live", () => {
    expect(isStubPreviewUrl("https://preview.stub.fairlx.local/abc/3000")).toBe(true);
    const preview = describeCodingPreview({
      previewUrl: "https://preview.stub.fairlx.local/abc/3000",
      driver: "stub",
      status: "running",
      sandboxId: "stub-1",
    });
    expect(preview.live).toBe(false);
    expect(preview.stub).toBe(true);
    expect(preview.note).toMatch(/AZURE_SANDBOX_/);
  });

  it("marks Azure URLs as live only after health-check", () => {
    const preview = describeCodingPreview({
      previewUrl: "https://sandbox.westus3.azuredevcompute.io/p/3000",
      driver: "azure",
      status: "running",
      sandboxId: "box-1",
      previewLive: true,
    });
    expect(preview.live).toBe(true);
    expect(preview.stub).toBe(false);
  });

  it("does not iframe an Azure URL until previewLive is true", () => {
    const waiting = describeCodingPreview({
      previewUrl: "https://sandbox.westus3.azuredevcompute.io/p/3000",
      driver: "azure",
      status: "running",
      sandboxId: "box-1",
    });
    expect(waiting.live).toBe(false);
    expect(waiting.preparing).toBe(true);
  });

  it("does not iframe an Azure URL until health-check sets previewLive", () => {
    const preview = describeCodingPreview({
      previewUrl: "https://sandbox.westus3.azuredevcompute.io/p/3000",
      driver: "azure",
      status: "running",
      sandboxId: "box-1",
      previewLive: false,
    });
    expect(preview.live).toBe(false);
    expect(preview.preparing).toBe(true);
  });
});
