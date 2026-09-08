export type FairlxMentionKind = "fairlx" | "fairlx-auto" | null;

const AUTO_RE = /@(?:fairlx-auto|fairlx_auto)\b/i;
const FAIRLX_RE = /@fairlx\b/i;

export function parseFairlxMention(text: string): FairlxMentionKind {
  const plain = (text || "").replace(/<[^>]+>/g, " ");
  if (AUTO_RE.test(plain)) return "fairlx-auto";
  if (FAIRLX_RE.test(plain)) return "fairlx";
  return null;
}

export function mentionsFairlxAgent(text: string): boolean {
  return parseFairlxMention(text) != null;
}

export function mentionsFairlxAuto(text: string): boolean {
  return parseFairlxMention(text) === "fairlx-auto";
}

export function extractWorkItemKey(text: string): string | undefined {
  const match = (text || "").match(/\b([A-Z][A-Z0-9]{1,9}-\d+)\b/);
  return match?.[1];
}

type DiscordOption = {
  name?: string;
  value?: unknown;
  options?: DiscordOption[];
};

/** Flatten Discord slash / message-command payloads into mention text. */
export function extractDiscordInteractionText(body: {
  content?: string;
  data?: {
    name?: string;
    options?: DiscordOption[];
    resolved?: { messages?: Record<string, { content?: string }> };
  };
}): string {
  const chunks: string[] = [];
  if (body.content) chunks.push(body.content);
  if (body.data?.name) chunks.push(body.data.name);
  const walk = (options?: DiscordOption[]) => {
    for (const option of options ?? []) {
      if (typeof option.value === "string") chunks.push(option.value);
      if (option.options) walk(option.options);
    }
  };
  walk(body.data?.options);
  for (const message of Object.values(body.data?.resolved?.messages ?? {})) {
    if (message?.content) chunks.push(message.content);
  }
  return chunks.join(" ");
}
