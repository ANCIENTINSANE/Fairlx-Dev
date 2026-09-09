export const MAX_AGENT_IMAGES = 4;
export const MAX_IMAGE_DATA_URL_CHARS = 180_000;

export type AttachedImage = {
  name: string;
  mime: string;
  dataUrl: string;
  omitted?: boolean;
};

export type ChatUserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

const IMAGE_START = "<<<FAIRLX_IMAGE";
const IMAGE_END = "<<<END_FAIRLX_IMAGE>>>";
const IMAGE_BLOCK_RE =
  /<<<FAIRLX_IMAGE name=("(?:\\.|[^"\\])*") mime=("(?:\\.|[^"\\])*")( omitted="1")?>>>\r?\n?([\s\S]*?)\r?\n?<<<END_FAIRLX_IMAGE>>>/g;

function parseQuoted(raw: string | undefined, fallback: string): string {
  let value = raw ?? JSON.stringify(fallback);
  try {
    value = JSON.parse(value) as string;
  } catch {
    value = value.replace(/^"|"$/g, "");
  }
  return value || fallback;
}

export function imageMimeFromDataUrl(dataUrl: string): string {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);/i.exec(dataUrl);
  return match?.[1]?.toLowerCase() || "image/jpeg";
}

export function formatAttachedImages(images: AttachedImage[]): string {
  return images
    .filter((image) => image.dataUrl.trim() || image.omitted)
    .map((image) => {
      const name = JSON.stringify(image.name);
      const mime = JSON.stringify(image.mime || "image/jpeg");
      if (image.omitted) {
        return `${IMAGE_START} name=${name} mime=${mime} omitted="1">>>\n[image omitted]\n${IMAGE_END}`;
      }
      return `${IMAGE_START} name=${name} mime=${mime}>>>\n${image.dataUrl.trim()}\n${IMAGE_END}`;
    })
    .join("\n\n");
}

export function extractAttachedImages(content: string): AttachedImage[] {
  if (!content.includes(IMAGE_START)) return [];
  const images: AttachedImage[] = [];
  const pattern = new RegExp(IMAGE_BLOCK_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    const omitted = Boolean(match[3]);
    const dataUrl = (match[4] ?? "").trim();
    images.push({
      name: parseQuoted(match[1], "image"),
      mime: parseQuoted(match[2], "image/jpeg"),
      dataUrl,
      omitted,
    });
  }
  return images;
}

export function stripAttachedImages(content: string, placeholder = false): string {
  if (!content.includes(IMAGE_START)) return content;
  const next = content.replace(new RegExp(IMAGE_BLOCK_RE.source, "g"), (_full, nameRaw) => {
    if (!placeholder) return "";
    return `\n[Attached image: ${parseQuoted(nameRaw, "image")}]\n`;
  });
  return next.replace(/\n{3,}/g, "\n\n").trim();
}

export function hasFullAttachedImages(content: string): boolean {
  return extractAttachedImages(content).some((image) => !image.omitted && image.dataUrl.startsWith("data:image/"));
}

export function stubAttachedImages(content: string): string {
  const images = extractAttachedImages(content);
  if (!images.some((image) => !image.omitted && image.dataUrl.startsWith("data:"))) return content;
  const stripped = stripAttachedImages(content);
  const stubs = images.map((image) => ({ ...image, omitted: true, dataUrl: "" }));
  return [formatAttachedImages(stubs), stripped].filter(Boolean).join("\n\n");
}

/** Keep bytes only on the most recent image-bearing user message in the last few turns. */
export function keepLatestImages<T extends { role: string; content: string }>(messages: T[]): T[] {
  const userIndexes: number[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") userIndexes.push(index);
  }
  const recentUsers = new Set(userIndexes.slice(-4));
  let keep = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user" || !recentUsers.has(index)) continue;
    if (hasFullAttachedImages(message.content)) {
      keep = index;
      break;
    }
  }
  return messages.map((message, index) => {
    if (message.role !== "user" || index === keep) return message;
    if (!hasFullAttachedImages(message.content)) return message;
    return { ...message, content: stubAttachedImages(message.content) };
  });
}

export function userContentForChatCompletions(content: string): string | ChatUserContentPart[] {
  const images = extractAttachedImages(content).filter(
    (image) => !image.omitted && image.dataUrl.startsWith("data:image/"),
  );
  if (!images.length) return content;
  const text = stripAttachedImages(content).trim();
  const parts: ChatUserContentPart[] = [
    {
      type: "text",
      text: text || "The user attached image(s). Use them as visual context.",
    },
  ];
  for (const image of images) {
    parts.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }
  return parts;
}
