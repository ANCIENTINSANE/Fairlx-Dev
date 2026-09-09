export type SelfTrainProgress = {
  percent: number;
  stage?: string;
  answered?: number;
  total?: number;
  done?: boolean;
  error?: string;
};

export function parseSelfTrainLine(line: string): SelfTrainProgress | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (!payload.startsWith("{")) return null;
  try {
    const event = JSON.parse(payload) as SelfTrainProgress;
    if (typeof event.percent !== "number" && !event.done && !event.error) return null;
    return event;
  } catch {
    return null;
  }
}

export function consumeSelfTrainChunk(
  buffer: string,
  chunk: string,
  onEvent: (event: SelfTrainProgress) => void,
): string {
  const next = `${buffer}${chunk}`.replace(/\r\n/g, "\n");
  const parts = next.split("\n");
  const rest = parts.pop() ?? "";
  for (const line of parts) {
    const event = parseSelfTrainLine(line);
    if (event) onEvent(event);
  }
  return rest;
}
