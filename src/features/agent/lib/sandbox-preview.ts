export function isStubPreviewUrl(url?: string): boolean {
  return Boolean(url && /preview\.stub\.fairlx\.local/i.test(url));
}

export function describeCodingPreview(input: {
  previewUrl?: string;
  driver?: string;
  status?: string;
  sandboxId?: string;
  previewLive?: boolean;
}): {
  url: string;
  driver: string;
  stub: boolean;
  live: boolean;
  preparing: boolean;
  note: string;
} {
  const url = input.previewUrl?.trim() || "";
  const stub = input.driver === "stub" || isStubPreviewUrl(url);
  const driver = input.driver || (stub ? "stub" : url ? "azure" : "none");
  const healthLive = input.previewLive === true;
  const live = !stub && driver !== "sessions" && Boolean(url) && healthLive;
  const preparing =
    !live &&
    (input.status === "queued" ||
      input.status === "preparing" ||
      Boolean(input.sandboxId) ||
      (Boolean(url) && !live && driver === "azure" && !healthLive));
  let note = "";
  if (stub) {
    note =
      "Azure Container Apps Sandboxes are not configured. This preview URL is a stub and will not load. Set AZURE_SANDBOX_TENANT_ID, CLIENT_ID, CLIENT_SECRET, SUBSCRIPTION_ID, RESOURCE_GROUP, and GROUP_ID.";
  } else if (driver === "sessions") {
    note = "Dynamic session fallback cannot expose preview ports. Use Azure Container Apps Sandboxes for a live preview.";
  } else if (live) {
    note = "Live sandbox app preview. This is the running app in Azure, not github.dev.";
  } else if (input.status === "preparing" || input.status === "queued") {
    note = "Preparing the sandbox: clone, install, and start the dev server. Preview appears when the port is healthy.";
  } else if (Boolean(url) && !live) {
    note = "A preview URL exists but the app is not healthy yet. Fairlx will iframe it only after a live health check.";
  } else if (preparing) {
    note = "Sandbox is preparing. Preview appears here when install + start succeed and the port is healthy.";
  } else if (!url) {
    note = "No sandbox preview yet.";
  }
  return { url, driver, stub, live, preparing, note };
}
