import { DEEPSEEK_FLASH_MODEL_ID, DEEPSEEK_PRO_MODEL_ID, DEFAULT_FAIRLX_MCP_SERVER_NAME, PERSONAL_MCP_SERVER_NAME, PERSONAL_MCP_URL, isPlatformGrokEnabled } from "../constants";
import type { AgentAiConfigPublic, AgentModel, AgentRun, McpConfig } from "../types";
import type { AgentCrewHints } from "./subagent-tree";

export function defaultMcpConfig(): McpConfig {
  return {
    mcpServers: {
      [DEFAULT_FAIRLX_MCP_SERVER_NAME]: {
        url: "/api/mcp",
        transport: "http",
        disabled: false,
      },
      [PERSONAL_MCP_SERVER_NAME]: {
        url: PERSONAL_MCP_URL,
        transport: "http",
        disabled: false,
      },
    },
  };
}

export function selectedModelLabel(config: AgentAiConfigPublic | undefined): string {
  if (!config) return "Select model";
  if (config.mode === "auto") return "Auto";
  const selected = config.models.find((model) => model.id === config.selectedModelId && model.isEnabled);
  return selected?.displayName || "Select model";
}

export function resolvedModelDisplayName(config: AgentAiConfigPublic | undefined): string | undefined {
  if (!config) return undefined;
  if (config.resolvedModelName) return config.resolvedModelName;
  const id = config.mode === "auto" ? config.resolvedModelId : config.selectedModelId;
  return config.models.find((model) => model.id === id && model.isEnabled)?.displayName;
}

export function enabledModels(config: AgentAiConfigPublic | undefined): AgentModel[] {
  if (!config) return [];
  const enabledProviders = new Set(
    config.providers.filter((provider) => provider.isEnabled).map((provider) => provider.id)
  );
  return config.models.filter((model) => model.isEnabled && enabledProviders.has(model.providerId));
}

export function displayNameForModelId(config: AgentAiConfigPublic | undefined, modelId?: string): string | undefined {
  if (!config || !modelId) return undefined;
  return config.models.find((model) => model.id === modelId || model.modelId === modelId)?.displayName;
}

export function workerModelFromConfig(config: AgentAiConfigPublic | undefined, preferPro?: boolean): { id?: string; name: string } {
  if (preferPro) {
    const pro = config?.models.find((model) => model.id === DEEPSEEK_PRO_MODEL_ID && model.isEnabled);
    if (pro) return { id: pro.id, name: pro.displayName };
  }
  const flash = config?.models.find((model) => model.id === DEEPSEEK_FLASH_MODEL_ID && model.isEnabled);
  if (flash) return { id: flash.id, name: flash.displayName };
  const fallback = resolvedModelDisplayName(config);
  return { id: config?.resolvedModelId, name: fallback || "DeepSeek V4 Flash" };
}

export function crewModelHints(config: AgentAiConfigPublic | undefined, run?: AgentRun): AgentCrewHints {
  const worker = workerModelFromConfig(config, run?.kind === "coding_session");
  const orchestratorId =
    run?.modelId || (config?.mode === "auto" ? config.resolvedModelId : config?.selectedModelId);
  const fallbackOrchestrator = isPlatformGrokEnabled() ? "Grok 4.6" : "DeepSeek V4 Flash";
  return {
    orchestratorModelName:
      displayNameForModelId(config, run?.modelId) || resolvedModelDisplayName(config) || fallbackOrchestrator,
    orchestratorModelId: orchestratorId,
    workerModelName: worker.name,
    workerModelId: worker.id,
  };
}
