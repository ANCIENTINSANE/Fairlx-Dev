import type { AgentContextChip } from "../types";
import { isReadableTextFile } from "./attachments";
import { MAX_AGENT_IMAGES, MAX_IMAGE_DATA_URL_CHARS, imageMimeFromDataUrl } from "./attach-images";
import { MAX_ATTACHED_FILE_CHARS } from "./limits";

export const AGENT_FILE_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,image/bmp,.png,.jpg,.jpeg,.gif,.webp,.md,.markdown,.pdf,.txt,.ts,.tsx,.js,.jsx,.json";

const VIDEO_NAME_RE = /\.(mp4|m4v|mov|webm|avi|mkv|mpeg|mpg|wmv|flv|ogv|3gp)$/i;
const WORD_NAME_RE = /\.(doc|docx|dot|dotx|docm|dotm)$/i;
const RASTER_IMAGE_NAME_RE = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;
const WORD_MIME_RE =
  /^(application\/msword|application\/vnd\.ms-word|application\/vnd\.openxmlformats-officedocument\.wordprocessingml)/i;

export function isVideoAttachment(name: string, type = ""): boolean {
  const mime = type.toLowerCase();
  if (mime.startsWith("video/")) return true;
  return VIDEO_NAME_RE.test(name);
}

export function isWordAttachment(name: string, type = ""): boolean {
  const mime = type.toLowerCase();
  if (WORD_MIME_RE.test(mime)) return true;
  return WORD_NAME_RE.test(name);
}

export function isRasterImageFile(name: string, type = ""): boolean {
  const mime = type.toLowerCase();
  if (mime === "image/svg+xml") return false;
  if (mime.startsWith("image/")) return true;
  return RASTER_IMAGE_NAME_RE.test(name);
}

export function attachmentRejectReason(file: { name: string; type?: string }): string | null {
  const type = file.type ?? "";
  if (isVideoAttachment(file.name, type)) return "Videos can't be sent to the agent.";
  if (isWordAttachment(file.name, type)) {
    return "Word documents can't be sent to the agent. Paste an image or attach markdown, text, or PDF.";
  }
  return null;
}

export function filesFromDataTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const fromFiles = Array.from(data.files ?? []);
  if (fromFiles.length) return fromFiles;
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

async function readFileAsDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  const mime = file.type || "image/png";
  return `data:${mime};base64,${btoa(binary)}`;
}

async function compressImageFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxEdge = 1280;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    throw new Error("Couldn't read that image.");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  let quality = 0.82;
  let url = canvas.toDataURL("image/jpeg", quality);
  while (url.length > MAX_IMAGE_DATA_URL_CHARS && quality > 0.45) {
    quality -= 0.12;
    url = canvas.toDataURL("image/jpeg", quality);
  }
  return url;
}

async function fileToImageDataUrl(file: File): Promise<string> {
  const original = await readFileAsDataUrl(file);
  const canCompress =
    typeof createImageBitmap === "function" && typeof document !== "undefined" && typeof document.createElement === "function";
  if (canCompress) {
    try {
      const compressed = await compressImageFile(file);
      if (original.length <= MAX_IMAGE_DATA_URL_CHARS && original.length <= compressed.length) return original;
      if (compressed.length > MAX_IMAGE_DATA_URL_CHARS) {
        throw new Error("Image is too large. Try a smaller screenshot.");
      }
      return compressed;
    } catch (error) {
      if (original.length <= MAX_IMAGE_DATA_URL_CHARS) return original;
      throw error instanceof Error ? error : new Error("Couldn't read that image.");
    }
  }
  if (original.length > MAX_IMAGE_DATA_URL_CHARS) {
    throw new Error("Image is too large. Try a smaller screenshot.");
  }
  return original;
}

function imageChipId(file: File): string {
  return `img-${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function chipFromFile(file: File): Promise<AgentContextChip> {
  const blocked = attachmentRejectReason(file);
  if (blocked) throw new Error(blocked);

  if (isRasterImageFile(file.name, file.type)) {
    const dataUrl = await fileToImageDataUrl(file);
    return {
      kind: "image",
      id: imageChipId(file),
      label: file.name || "image",
      meta: imageMimeFromDataUrl(dataUrl).replace("image/", "") || "image",
      content: dataUrl,
    };
  }

  const id = `${file.name}-${file.size}-${file.lastModified}`;
  if (!isReadableTextFile(file.name, file.type)) {
    return {
      kind: "file",
      id,
      label: file.name,
      meta: file.type || "binary",
    };
  }
  const raw = await file.text();
  const truncated = raw.length > MAX_ATTACHED_FILE_CHARS;
  const body = truncated
    ? `${raw.slice(0, MAX_ATTACHED_FILE_CHARS)}\n\n[Truncated after ${MAX_ATTACHED_FILE_CHARS} characters.]`
    : raw;
  return {
    kind: "file",
    id,
    label: file.name,
    meta: truncated ? "text truncated" : file.type || "text",
    content: body,
  };
}

export async function chipsFromFiles(
  files: File[],
  existingImageCount = 0,
): Promise<{ chips: AgentContextChip[]; errors: string[] }> {
  const chips: AgentContextChip[] = [];
  const errors: string[] = [];
  let images = existingImageCount;
  for (const file of files) {
    const blocked = attachmentRejectReason(file);
    if (blocked) {
      errors.push(blocked);
      continue;
    }
    if (isRasterImageFile(file.name, file.type) && images >= MAX_AGENT_IMAGES) {
      errors.push(`You can attach up to ${MAX_AGENT_IMAGES} images.`);
      continue;
    }
    try {
      const chip = await chipFromFile(file);
      if (chip.kind === "image") images += 1;
      chips.push(chip);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Couldn't attach ${file.name}.`);
    }
  }
  return { chips, errors: [...new Set(errors)] };
}
