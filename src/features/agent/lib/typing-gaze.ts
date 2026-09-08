/** Map the composer caret onto 0 (left) … 1 (right) for the agent looking down. */

let mirrorDiv: HTMLDivElement | null = null;

function getOrCreateMirror(): HTMLDivElement | null {
  if (typeof document === "undefined") return null;
  if (!mirrorDiv) {
    mirrorDiv = document.createElement("div");
    mirrorDiv.setAttribute("aria-hidden", "true");
    mirrorDiv.style.position = "fixed";
    mirrorDiv.style.top = "-99999px";
    mirrorDiv.style.left = "-99999px";
    mirrorDiv.style.visibility = "hidden";
    mirrorDiv.style.pointerEvents = "none";
    mirrorDiv.style.zIndex = "-99999";
    mirrorDiv.style.whiteSpace = "pre-wrap";
    mirrorDiv.style.wordWrap = "break-word";
    mirrorDiv.style.overflowWrap = "break-word";
    mirrorDiv.style.border = "none";
    mirrorDiv.style.margin = "0";
    document.body.appendChild(mirrorDiv);
  }
  return mirrorDiv;
}

function measureTextareaCaretX(element: HTMLTextAreaElement, caret: number): number | null {
  try {
    const mirror = getOrCreateMirror();
    if (!mirror || typeof window === "undefined") return null;

    const style = window.getComputedStyle(element);

    mirror.style.fontFamily = style.fontFamily;
    mirror.style.fontSize = style.fontSize;
    mirror.style.fontWeight = style.fontWeight;
    mirror.style.fontStyle = style.fontStyle;
    mirror.style.letterSpacing = style.letterSpacing;
    mirror.style.lineHeight = style.lineHeight;
    mirror.style.textTransform = style.textTransform;
    mirror.style.wordSpacing = style.wordSpacing;
    mirror.style.wordBreak = style.wordBreak;
    mirror.style.tabSize = style.tabSize;
    mirror.style.boxSizing = "border-box";
    mirror.style.paddingLeft = style.paddingLeft;
    mirror.style.paddingRight = style.paddingRight;
    mirror.style.paddingTop = style.paddingTop;
    mirror.style.paddingBottom = style.paddingBottom;
    mirror.style.width = `${element.clientWidth}px`;

    const textBeforeCaret = element.value.slice(0, caret);
    mirror.textContent = textBeforeCaret;

    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.appendChild(marker);

    const mirrorRect = mirror.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();

    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const caretX = markerRect.left - mirrorRect.left - paddingLeft;

    mirror.textContent = "";

    return Number.isFinite(caretX) ? caretX : null;
  } catch {
    return null;
  }
}

export function typingGazeProgress(input: {
  value: string;
  caret?: number;
  widthPx: number;
  fontSizePx?: number;
  paddingXPx?: number;
  element?: HTMLTextAreaElement | null;
}): number {
  const caret = Math.max(0, Math.min(input.caret ?? input.value.length, input.value.length));
  if (!input.value.length || caret === 0) return 0.12;

  if (input.element) {
    const caretX = measureTextareaCaretX(input.element, caret);
    if (caretX !== null) {
      const style = typeof window !== "undefined" ? window.getComputedStyle(input.element) : null;
      const paddingLeft = style ? parseFloat(style.paddingLeft) || 0 : 0;
      const paddingRight = style ? parseFloat(style.paddingRight) || 0 : 0;
      const usable = Math.max(input.element.clientWidth - paddingLeft - paddingRight, 1);
      return Math.max(0, Math.min(1, caretX / usable));
    }
  }

  const textBeforeCaret = input.value.slice(0, caret);
  const line = textBeforeCaret.split("\n").pop() ?? "";
  if (!line.length) return 0.12;

  const fontSize = input.fontSizePx && input.fontSizePx > 0 ? input.fontSizePx : 14;
  const usable = Math.max(input.widthPx - (input.paddingXPx ?? 0), fontSize);
  if (usable <= 0) return 0.12;

  let currentLineWidth = 0;
  const tokens = line.match(/\s+|[^\s]+/g) ?? [];
  for (const token of tokens) {
    let tokenWidth = 0;
    for (let i = 0; i < token.length; i++) {
      const ch = token[i];
      if (ch === " ") {
        tokenWidth += fontSize * 0.28;
      } else if (/[ijlrtfI.,!':;]/.test(ch)) {
        tokenWidth += fontSize * 0.32;
      } else if (/[wmWM@%]/.test(ch)) {
        tokenWidth += fontSize * 0.72;
      } else {
        tokenWidth += fontSize * 0.52;
      }
    }

    if (currentLineWidth + tokenWidth <= usable) {
      currentLineWidth += tokenWidth;
    } else {
      if (currentLineWidth > 0 && !/^\s+$/.test(token)) {
        currentLineWidth = tokenWidth <= usable ? tokenWidth : tokenWidth % usable;
      } else {
        currentLineWidth = Math.min(usable, currentLineWidth + tokenWidth);
      }
    }
  }

  return Math.max(0, Math.min(1, currentLineWidth / usable));
}

