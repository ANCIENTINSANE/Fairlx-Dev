/** Map the composer caret onto 0 (left) … 1 (right) for the agent looking down. */
export function typingGazeProgress(input: {
  value: string;
  caret?: number;
  widthPx: number;
  fontSizePx?: number;
  paddingXPx?: number;
}): number {
  const caret = Math.max(0, Math.min(input.caret ?? input.value.length, input.value.length));
  const line = (input.value.slice(0, caret).split("\n").pop() ?? "");
  const fontSize = input.fontSizePx && input.fontSizePx > 0 ? input.fontSizePx : 14;
  const usable = Math.max(input.widthPx - (input.paddingXPx ?? 0), fontSize);
  if (usable <= 0) return 0.12;
  const charW = fontSize * 0.54;
  const x = (line.length * charW) % usable;
  if (!line.length) return 0.12;
  return Math.max(0, Math.min(1, x / usable));
}
