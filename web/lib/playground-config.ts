import { loadFromStorage, saveToStorage } from "@/lib/persistence";

const STORAGE_KEY = "playground_capability_configs";
/** Tools hidden from the frontend UI (not user-toggleable). */
export const FRONTEND_HIDDEN_TOOLS = new Set(["geogebra_analysis"]);

/** Remove frontend-hidden tools from a tool list.
 * @param tools - Raw tool names.
 * @returns Filtered list with hidden tools removed. */
export function filterFrontendTools(tools: string[]): string[] {
  return tools.filter((tool) => !FRONTEND_HIDDEN_TOOLS.has(tool));
}

/** Per-capability playground configuration (enabled tools, KB, extra config). */
export interface CapabilityPlaygroundConfig {
  enabledTools: string[];
  knowledgeBase: string;
  config?: Record<string, unknown>;
}

/** Map of capability name → playground config. */
export type CapabilityPlaygroundConfigMap = Record<
  string,
  CapabilityPlaygroundConfig
>;

/** Load all capability playground configs from localStorage.
 * @returns Stored config map (empty object if none). */
export function loadCapabilityPlaygroundConfigs(): CapabilityPlaygroundConfigMap {
  return loadFromStorage<CapabilityPlaygroundConfigMap>(STORAGE_KEY, {});
}

/** Resolve a capability's playground config, falling back to defaults.
 * @param configs - Stored config map.
 * @param capabilityName - The capability to resolve.
 * @param defaultTools - Tools to use when none are stored.
 * @returns Resolved config with filtered tools and defaults applied. */
export function resolveCapabilityPlaygroundConfig(
  configs: CapabilityPlaygroundConfigMap,
  capabilityName: string,
  defaultTools: string[],
): CapabilityPlaygroundConfig {
  const stored = configs[capabilityName];
  return {
    enabledTools: Array.from(
      new Set(filterFrontendTools(stored?.enabledTools ?? defaultTools)),
    ),
    knowledgeBase: stored?.knowledgeBase ?? "",
    config:
      stored?.config && typeof stored.config === "object" ? stored.config : {},
  };
}

/** Save a capability's playground config to localStorage and return the updated map.
 * @param configs - Current config map.
 * @param capabilityName - The capability to update.
 * @param config - The new config for that capability.
 * @returns The updated config map. */
export function saveCapabilityPlaygroundConfig(
  configs: CapabilityPlaygroundConfigMap,
  capabilityName: string,
  config: CapabilityPlaygroundConfig,
): CapabilityPlaygroundConfigMap {
  const next = {
    ...configs,
    [capabilityName]: {
      enabledTools: Array.from(
        new Set(filterFrontendTools(config.enabledTools)),
      ),
      knowledgeBase: config.knowledgeBase,
      config:
        config.config && typeof config.config === "object" ? config.config : {},
    },
  };
  saveToStorage(STORAGE_KEY, next);
  return next;
}
