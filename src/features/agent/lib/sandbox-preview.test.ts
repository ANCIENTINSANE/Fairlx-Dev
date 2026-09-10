import { describe, expect, it } from "vitest";

import {
  codingSessionResumeNote,
  describeCodingPreview,
  ensureAzurePreviewUrl,
  isBrokenAzurePreviewUrl,
  isStubPreviewUrl,
  repairAzurePreviewUrl,
  rewriteAzurePreviewMarkdown,
} from "./sandbox-preview";

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

  it("repairs adcproxy hostnames that are missing the sandbox UUID", () => {
    const sandboxId = "421b50f0-ed05-46b1-9ade-caafc10a7ea8";
    const broken = "https://--3000.centralindia.adcproxy.io/";
    const good = `https://${sandboxId}--3000.centralindia.adcproxy.io/`;
    expect(isBrokenAzurePreviewUrl(broken)).toBe(true);
    expect(isBrokenAzurePreviewUrl(good)).toBe(false);
    expect(ensureAzurePreviewUrl(broken, sandboxId)).toBe(good);
    expect(repairAzurePreviewUrl(broken, { previewUrl: good, sandboxId })).toBe(good);
    expect(
      rewriteAzurePreviewMarkdown(
        `The sandbox is live! [Open Preview](${broken})`,
        { previewUrl: good, sandboxId },
      ),
    ).toContain(good);
    expect(rewriteAzurePreviewMarkdown(`[Open Preview](${broken})`, { previewUrl: good })).not.toContain(
      "https://--3000.",
    );
  });

  it("tells the model a resumed live preview is still the previous site", () => {
    const live = describeCodingPreview({
      previewUrl: "https://example.azurecontainerapps.io",
      driver: "azure",
      status: "running",
      sandboxId: "sb",
      previewLive: true,
    });
    expect(codingSessionResumeNote(true, live)).toMatch(/coding_session_implement/);
    expect(codingSessionResumeNote(false, live)).toBe(live.note);
  });
});
