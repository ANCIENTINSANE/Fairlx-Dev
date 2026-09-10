import { calculateCustomerTokenCostUSD } from "@/lib/ai-billing";
import type { AgentLlmUsagePayload, AgentToolEvent } from "../types";

export type AggregatedLlmUsage = AgentLlmUsagePayload & {
  calls: number;
  orchestratorCalls: number;
  subagentCalls: number;
  models: string[];
};

const USAGE_TITLE_RE = /^(.*?)\s·\s([\d,]+)\s+tokens\b/i;

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function isLlmUsageEvent(event: AgentToolEvent): boolean {
  return event.type === "llm_usage";
}

export function looksLikeLlmUsageEvent(event: AgentToolEvent): boolean {
  if (event.type === "context_meter") return false;
  if (isLlmUsageEvent(event)) return true;
  if (event.payload && typeof event.payload === "object" && "totalTokens" in event.payload) return true;
  return USAGE_TITLE_RE.test(event.title) && /cache|billed|byok/i.test(event.detail || event.title);
}

function fromTitleDetail(event: AgentToolEvent): AgentLlmUsagePayload | null {
  const titleMatch = event.title.match(USAGE_TITLE_RE);
  if (!titleMatch) return null;
  const totalTokens = Number(titleMatch[2]!.replaceAll(",", ""));
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null;
  const costMatch = event.detail?.match(/\$([0-9.]+)/);
  const cacheMatch = event.detail?.match(/(\d+(?:\.\d+)?)%\s*cache/i);
  const billed = !/byok|not billed/i.test(event.detail || "");
  const hit = cacheMatch ? Number(cacheMatch[1]) : 0;
  const cachePct = Number.isFinite(hit) ? hit : 0;
  return {
    role: "orchestrator",
    operationId: event.id,
    model: "",
    modelId: "",
    displayName: titleMatch[1]!.trim() || "Unknown model",
    promptTokens: totalTokens,
    completionTokens: 0,
    cachedTokens: cachePct > 0 ? Math.round((totalTokens * cachePct) / 100) : 0,
    totalTokens,
    estimated: true,
    billed,
    inputPricePerMillionTokens: 0,
    outputPricePerMillionTokens: 0,
    cachedInputPricePerMillionTokens: 0,
    providerCostUSD: billed ? 0 : Number(costMatch?.[1] || 0),
    costUSD: billed ? Number(costMatch?.[1] || 0) : 0,
    markup: 1.15,
    cacheHitPercent: cachePct,
  };
}

export function parseLlmUsagePayload(event: AgentToolEvent): AgentLlmUsagePayload | null {
  if (!looksLikeLlmUsageEvent(event)) return null;
  if (event.payload && typeof event.payload === "object") {
    const raw = event.payload as Record<string, unknown>;
    const promptTokens = asNumber(raw.promptTokens);
    const completionTokens = asNumber(raw.completionTokens);
    const cachedTokens = Math.min(promptTokens, asNumber(raw.cachedTokens));
    const totalTokens = asNumber(raw.totalTokens) || promptTokens + completionTokens;
    if (totalTokens > 0) {
      const displayName =
        String(raw.displayName || raw.model || raw.modelId || "").trim() || "Unknown model";
      return {
        role: raw.role === "subagent" ? "subagent" : "orchestrator",
        specialist: typeof raw.specialist === "string" ? raw.specialist : undefined,
        subagentId: typeof raw.subagentId === "string" ? raw.subagentId : undefined,
        iteration: typeof raw.iteration === "number" ? raw.iteration : undefined,
        operationId: String(raw.operationId || event.id),
        model: String(raw.model || ""),
        modelId: String(raw.modelId || ""),
        displayName,
        promptTokens,
        completionTokens,
        cachedTokens,
        totalTokens,
        estimated: raw.estimated === true,
        billed: raw.billed === true,
        inputPricePerMillionTokens: asNumber(raw.inputPricePerMillionTokens),
        outputPricePerMillionTokens: asNumber(raw.outputPricePerMillionTokens),
        cachedInputPricePerMillionTokens: asNumber(raw.cachedInputPricePerMillionTokens),
        providerCostUSD: asNumber(raw.providerCostUSD),
        costUSD: asNumber(raw.costUSD),
        markup: asNumber(raw.markup) || 1.15,
        cacheHitPercent: asNumber(raw.cacheHitPercent) || cacheHitPercent(promptTokens, cachedTokens),
        pricingSource: typeof raw.pricingSource === "string" ? raw.pricingSource : undefined,
      };
    }
  }
  return fromTitleDetail(event);
}

export function compactLlmUsagePayload(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const parsed = parseLlmUsagePayload({
    id: "compact",
    type: "llm_usage",
    title: "usage",
    payload,
    createdAt: new Date().toISOString(),
    runId: "",
  });
  if (!parsed) return undefined;
  return {
    role: parsed.role,
    specialist: parsed.specialist,
    subagentId: parsed.subagentId,
    iteration: parsed.iteration,
    operationId: parsed.operationId,
    model: parsed.model,
    modelId: parsed.modelId,
    displayName: parsed.displayName,
    promptTokens: parsed.promptTokens,
    completionTokens: parsed.completionTokens,
    cachedTokens: parsed.cachedTokens,
    totalTokens: parsed.totalTokens,
    estimated: parsed.estimated,
    billed: parsed.billed,
    inputPricePerMillionTokens: parsed.inputPricePerMillionTokens,
    outputPricePerMillionTokens: parsed.outputPricePerMillionTokens,
    cachedInputPricePerMillionTokens: parsed.cachedInputPricePerMillionTokens,
    providerCostUSD: parsed.providerCostUSD,
    costUSD: parsed.costUSD,
    markup: parsed.markup,
    cacheHitPercent: parsed.cacheHitPercent,
  };
}

export function cacheHitPercent(promptTokens: number, cachedTokens: number): number {
  if (promptTokens <= 0 || cachedTokens <= 0) return 0;
  return Math.min(100, (cachedTokens / promptTokens) * 100);
}

function hasTokenRates(item: AgentLlmUsagePayload): boolean {
  return item.inputPricePerMillionTokens > 0 || item.outputPricePerMillionTokens > 0;
}

function pricedUsageSlice(item: AgentLlmUsagePayload): AgentLlmUsagePayload {
  const promptTokens = Math.max(0, item.promptTokens);
  const completionTokens = Math.max(0, item.completionTokens);
  const cachedTokens = Math.min(promptTokens, Math.max(0, item.cachedTokens));
  const totalTokens = promptTokens + completionTokens;
  if (!hasTokenRates(item)) {
    return {
      ...item,
      promptTokens,
      completionTokens,
      cachedTokens,
      totalTokens: totalTokens || item.totalTokens,
      cacheHitPercent: cacheHitPercent(promptTokens, cachedTokens),
    };
  }
  const costs = calculateCustomerTokenCostUSD(
    {
      inputPricePerMillionTokens: item.inputPricePerMillionTokens,
      outputPricePerMillionTokens: item.outputPricePerMillionTokens,
      cachedInputPricePerMillionTokens: item.cachedInputPricePerMillionTokens,
    },
    promptTokens,
    completionTokens,
    cachedTokens,
  );
  return {
    ...item,
    promptTokens,
    completionTokens,
    cachedTokens,
    totalTokens,
    providerCostUSD: costs.providerCostUSD,
    costUSD: item.billed ? costs.costUSD : 0,
    markup: costs.markup,
    cacheHitPercent: cacheHitPercent(promptTokens, cachedTokens),
  };
}

export function aggregateLlmUsage(events: AgentToolEvent[]): AggregatedLlmUsage | null {
  const slices = events
    .map(parseLlmUsagePayload)
    .filter((item): item is AgentLlmUsagePayload => Boolean(item))
    .map(pricedUsageSlice);
  if (!slices.length) return null;
  const last = slices[slices.length - 1]!;
  const promptTokens = slices.reduce((sum, item) => sum + item.promptTokens, 0);
  const completionTokens = slices.reduce((sum, item) => sum + item.completionTokens, 0);
  const cachedTokens = slices.reduce((sum, item) => sum + item.cachedTokens, 0);
  const models = [...new Set(slices.map((item) => item.displayName).filter(Boolean))];
  const sameRates = slices.every(
    (item) =>
      item.inputPricePerMillionTokens === last.inputPricePerMillionTokens &&
      item.outputPricePerMillionTokens === last.outputPricePerMillionTokens &&
      item.cachedInputPricePerMillionTokens === last.cachedInputPricePerMillionTokens,
  );
  let providerCostUSD = slices.reduce((sum, item) => sum + item.providerCostUSD, 0);
  let costUSD = slices.reduce((sum, item) => sum + item.costUSD, 0);
  if (sameRates && hasTokenRates(last)) {
    const costs = calculateCustomerTokenCostUSD(
      {
        inputPricePerMillionTokens: last.inputPricePerMillionTokens,
        outputPricePerMillionTokens: last.outputPricePerMillionTokens,
        cachedInputPricePerMillionTokens: last.cachedInputPricePerMillionTokens,
      },
      promptTokens,
      completionTokens,
      cachedTokens,
    );
    providerCostUSD = costs.providerCostUSD;
    costUSD = slices.some((item) => item.billed) ? costs.costUSD : 0;
  }
  return {
    ...last,
    promptTokens,
    completionTokens,
    cachedTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: slices.some((item) => item.estimated),
    billed: slices.some((item) => item.billed),
    providerCostUSD,
    costUSD,
    cacheHitPercent: cacheHitPercent(promptTokens, cachedTokens),
    calls: slices.length,
    orchestratorCalls: slices.filter((item) => item.role === "orchestrator").length,
    subagentCalls: slices.filter((item) => item.role === "subagent").length,
    models,
  };
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value >= 1) return `$${value.toFixed(2)}`;
  const [whole, fraction = ""] = value.toFixed(6).split(".");
  const trimmed = fraction.replace(/0+$/, "");
  if (!trimmed) return `$${whole}.00`;
  return `$${whole}.${trimmed.padEnd(2, "0")}`;
}

export function formatTokenCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString();
}

export function formatPricePerMillion(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 0.1) return `$${value.toFixed(3)}`;
  if (value < 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(2)}`;
}

export function contextUtilizationPercent(tokens: number, maxInputTokens: number): number {
  if (maxInputTokens <= 0 || tokens <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((tokens / maxInputTokens) * 100)));
}

export function formatCompactUsageLine(usage: AggregatedLlmUsage): string {
  const models = usage.models.length ? usage.models.join(" · ") : usage.displayName || "Model";
  const parts = [
    models,
    `${formatTokenCount(usage.totalTokens)} tokens`,
    usage.billed ? formatUsd(usage.costUSD) : `${formatUsd(usage.providerCostUSD)} BYOK`,
  ];
  if (usage.cachedTokens > 0 || usage.cacheHitPercent > 0) {
    parts.push(`${Math.round(usage.cacheHitPercent)}% cache`);
  }
  if (usage.calls > 1) parts.push(`${usage.calls} calls`);
  if (usage.subagentCalls) {
    parts.push(`${usage.subagentCalls} subagent${usage.subagentCalls === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}
