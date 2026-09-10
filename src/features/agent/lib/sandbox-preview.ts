export function isStubPreviewUrl(url?: string): boolean {
  return Boolean(url && /preview\.stub\.fairlx\.local/i.test(url));
}

const AZURE_ADCPROXY_URL_RE =
  /https?:\/\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?--\d+\.[a-z0-9-]+\.adcproxy\.io\/?/gi;

export type AzurePreviewCanonical = {
  previewUrl?: string;
  sandboxId?: string;
};

function previewHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export function isBrokenAzurePreviewUrl(url?: string): boolean {
  const raw = (url || "").trim();
  if (!raw) return false;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const host = previewHostname(withScheme);
  if (host) return /\.adcproxy\.io$/i.test(host) && /^--\d+\./.test(host);
  return /https?:\/\/--\d+\./i.test(raw);
}

/** If Azure omitted the sandbox id from `{id}--port.region.adcproxy.io`, put it back. */
export function ensureAzurePreviewUrl(url: string, sandboxId?: string): string {
  const trimmed = (url || "").trim();
  const id = (sandboxId || "").trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (/\.adcproxy\.io$/i.test(parsed.hostname) && /^--\d+\./.test(parsed.hostname) && id) {
      parsed.hostname = `${id}${parsed.hostname}`;
      return parsed.toString();
    }
  } catch {
    if (id && /^https?:\/\/--\d+\./i.test(trimmed)) {
      return trimmed.replace(/^(https?:\/\/)/i, `$1${id}`);
    }
  }
  return trimmed;
}

export function repairAzurePreviewUrl(href: string | undefined, canonical?: AzurePreviewCanonical): string {
  const link = (href || "").trim();
  const fallback = ensureAzurePreviewUrl(canonical?.previewUrl || "", canonical?.sandboxId);
  const sandboxId = (canonical?.sandboxId || "").trim();
  if (isBrokenAzurePreviewUrl(link)) {
    if (fallback && !isBrokenAzurePreviewUrl(fallback)) return fallback;
    return ensureAzurePreviewUrl(link, sandboxId) || fallback || link;
  }
  return link || fallback;
}

/** Restore sandbox UUIDs that chat sanitizing or the model stripped from Azure preview links. */
export function rewriteAzurePreviewMarkdown(markdown: string, canonical?: AzurePreviewCanonical): string {
  if (!markdown) return markdown;
  AZURE_ADCPROXY_URL_RE.lastIndex = 0;
  return markdown.replace(AZURE_ADCPROXY_URL_RE, (match) => repairAzurePreviewUrl(match, canonical));
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
  const url = ensureAzurePreviewUrl(input.previewUrl?.trim() || "", input.sandboxId);
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

export function codingSessionResumeNote(
  resumed: boolean | undefined,
  preview: { live: boolean; note: string },
): string {
  if (resumed && preview.live) {
    return "Existing sandbox preview is still the previous site. Call coding_session_implement with the user's latest request so the live preview actually changes. Do not treat this URL as proof the new work is done.";
  }
  return preview.note;
}
