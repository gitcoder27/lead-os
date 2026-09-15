/**
 * Known-model catalog for Copilot providers — context window, output ceiling,
 * and reasoning support per model id. Values come from provider docs; profiles
 * can override either token field explicitly.
 */
export interface ModelCatalogEntry {
  /** Total context window (input + output), in tokens. */
  contextWindow: number;
  /** Maximum output tokens the model can generate. */
  maxOutputTokens: number;
  /** Whether the model emits reasoning_content / accepts reasoning params. */
  supportsReasoning: boolean;
}

const KNOWN_MODELS: Record<string, ModelCatalogEntry> = {
  // ZAI (api.z.ai) — docs.z.ai: 1M context, 128K max output.
  "glm-5.3-flash": { contextWindow: 1_048_576, maxOutputTokens: 131_072, supportsReasoning: true },
  "glm-5.3": { contextWindow: 1_048_576, maxOutputTokens: 131_072, supportsReasoning: true },
  // DeepSeek V4 (api.deepseek.com) — 1M context, 384K max output.
  "deepseek-v4-flash": { contextWindow: 1_000_000, maxOutputTokens: 384_000, supportsReasoning: true },
  "deepseek-v4-pro": { contextWindow: 1_000_000, maxOutputTokens: 384_000, supportsReasoning: true },
  // DeepSeek legacy ids (conservative v3.2-documented ceilings).
  "deepseek-chat": { contextWindow: 131_072, maxOutputTokens: 32_768, supportsReasoning: false },
  "deepseek-reasoner": { contextWindow: 131_072, maxOutputTokens: 32_768, supportsReasoning: true },
};

/**
 * Look up a model id — tolerates provider prefixes like "zai/glm-5.3-flash"
 * and case differences. Unknown models return undefined; callers then leave
 * the provider's own defaults in charge.
 */
export function lookupModelCatalog(model: string): ModelCatalogEntry | undefined {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const bare = normalized.split("/").pop() ?? normalized;
  return KNOWN_MODELS[normalized] ?? KNOWN_MODELS[bare];
}
