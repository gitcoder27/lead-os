import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type {
  AiAssistantConfig,
  AiProvider,
  AiProviderProfile,
  AiReasoningEffort,
  AssistantResponseStyle,
  UpdateAiAssistantConfigRequest,
} from "shared/types";
import { db } from "../db/connection";
import { configTable } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import {
  DEFAULT_AI_PROFILE_ID,
  clearAiApiKey,
  getPersistedAiApiKey,
  storeAiApiKey,
} from "./assistant-credentials.service";
import { lookupModelCatalog } from "./assistant-model-catalog";
import { normalizeWorkspaceId } from "./workspace.service";

const KEY_ENABLED = "ai_assistant_enabled";
const KEY_PROVIDER = "ai_provider";
const KEY_BASE_URL = "ai_base_url";
const KEY_MODEL = "ai_model";
const KEY_MAX_TOOL_ITERATIONS = "ai_max_tool_iterations";
const KEY_RESPONSE_STYLE = "ai_response_style";
const KEY_SUGGEST_FOLLOWUPS = "ai_suggest_followups";
const KEY_SHOW_THINKING_TRACE = "ai_show_thinking_trace";
const KEY_AUTO_CONFIRM = "ai_auto_confirm";
const KEY_PROVIDERS = "ai_providers";
const KEY_ACTIVE_PROVIDER = "ai_active_provider";

const DEFAULT_PROVIDER: AiProvider = "openai-compatible";
const DEFAULT_BASE_URL = "https://api.z.ai/api/paas/v4";
const DEFAULT_MODEL = "glm-5.3-flash";
const DEFAULT_MAX_TOOL_ITERATIONS = 6;
const DEFAULT_RESPONSE_STYLE: AssistantResponseStyle = "concise";

export type ResolvedAiAssistantConfig = AiAssistantConfig & { apiKey?: string };

/** Provider profile as stored in the `ai_providers` JSON blob — never holds the key. */
interface StoredAiProviderProfile {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  maxOutputTokens?: number;
  contextWindow?: number;
  reasoningEffort?: AiReasoningEffort;
  temperature?: number;
}

interface AiProviderState {
  profiles: StoredAiProviderProfile[];
  activeId: string | null;
  /** false when profiles were synthesized from legacy flat keys rather than the blob. */
  persisted: boolean;
}

function clampMaxToolIterations(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_TOOL_ITERATIONS;
  }
  return Math.min(10, Math.max(1, Math.trunc(value)));
}

export function normalizeAiBaseUrl(rawValue: string): string {
  const trimmed = rawValue.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpError(400, "AI base URL must be a valid http(s) URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new HttpError(400, "AI base URL must be a valid http(s) URL");
  }
  return trimmed;
}

function deriveProviderName(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.replace(/^(www\.|api\.)/, "") || "Provider";
  } catch {
    return "Provider";
  }
}

const REASONING_EFFORTS: readonly AiReasoningEffort[] = ["off", "low", "high", "max"];

function parsePositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function parseReasoningEffort(value: unknown): AiReasoningEffort | undefined {
  return REASONING_EFFORTS.includes(value as AiReasoningEffort) ? (value as AiReasoningEffort) : undefined;
}

function parseTemperature(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 2 ? value : undefined;
}

/** Carry the optional capability fields through the stored profile shape. */
function normalizeStoredProfile(entry: StoredAiProviderProfile): StoredAiProviderProfile {
  return {
    id: entry.id,
    name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : deriveProviderName(entry.baseUrl),
    baseUrl: entry.baseUrl,
    model: entry.model,
    maxOutputTokens: parsePositiveInt(entry.maxOutputTokens),
    contextWindow: parsePositiveInt(entry.contextWindow),
    reasoningEffort: parseReasoningEffort(entry.reasoningEffort),
    temperature: parseTemperature(entry.temperature),
  };
}

function parseStoredProfiles(raw: string | undefined): StoredAiProviderProfile[] | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    return parsed
      .filter(
        (entry): entry is StoredAiProviderProfile =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as StoredAiProviderProfile).id === "string" &&
          typeof (entry as StoredAiProviderProfile).baseUrl === "string" &&
          typeof (entry as StoredAiProviderProfile).model === "string"
      )
      .map(normalizeStoredProfile);
  } catch {
    return undefined;
  }
}

export class AssistantConfigService {
  private async getValue(workspaceId: string, key: string): Promise<string | undefined> {
    const rows = await db
      .select()
      .from(configTable)
      .where(and(eq(configTable.workspaceId, workspaceId), eq(configTable.key, key)))
      .limit(1);
    return rows[0]?.value;
  }

  private async upsertValue(workspaceId: string, key: string, value: string): Promise<void> {
    await db
      .insert(configTable)
      .values({ workspaceId, key, value })
      .onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value } });
  }

  private async deleteValue(workspaceId: string, key: string): Promise<void> {
    await db
      .delete(configTable)
      .where(and(eq(configTable.workspaceId, workspaceId), eq(configTable.key, key)));
  }

  /**
   * Provider profiles come from the `ai_providers` blob when present. Workspaces configured
   * before profiles existed get a synthesized "Default" profile over the flat ai_* keys —
   * its key stays in the original `ai_api_key` row (see DEFAULT_AI_PROFILE_ID).
   */
  private async getProfileState(workspaceId: string): Promise<AiProviderState> {
    const stored = parseStoredProfiles(await this.getValue(workspaceId, KEY_PROVIDERS));
    if (stored !== undefined) {
      const storedActive = await this.getValue(workspaceId, KEY_ACTIVE_PROVIDER);
      const activeId = stored.some((p) => p.id === storedActive)
        ? storedActive!
        : stored[0]?.id ?? null;
      return { profiles: stored, activeId, persisted: true };
    }

    const [baseUrl, model, apiKey] = await Promise.all([
      this.getValue(workspaceId, KEY_BASE_URL),
      this.getValue(workspaceId, KEY_MODEL),
      getPersistedAiApiKey(workspaceId),
    ]);
    if (!baseUrl?.trim() && !model?.trim() && !apiKey) {
      return { profiles: [], activeId: null, persisted: false };
    }
    return {
      profiles: [
        {
          id: DEFAULT_AI_PROFILE_ID,
          name: "Default",
          baseUrl: baseUrl?.trim() || DEFAULT_BASE_URL,
          model: model?.trim() || DEFAULT_MODEL,
        },
      ],
      activeId: DEFAULT_AI_PROFILE_ID,
      persisted: false,
    };
  }

  private async saveProfiles(
    workspaceId: string,
    profiles: StoredAiProviderProfile[],
    activeId: string | null
  ): Promise<void> {
    await this.upsertValue(workspaceId, KEY_PROVIDERS, JSON.stringify(profiles));
    if (activeId) {
      await this.upsertValue(workspaceId, KEY_ACTIVE_PROVIDER, activeId);
    } else {
      await this.deleteValue(workspaceId, KEY_ACTIVE_PROVIDER);
    }
  }

  /** Public (keyless) view of every saved profile plus the resolved active id. */
  async getProviders(workspaceId?: string): Promise<{ providers: AiProviderProfile[]; activeProviderId: string | null }> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const state = await this.getProfileState(normalizedWorkspaceId);
    const providers = await Promise.all(
      state.profiles.map(async (profile) => {
        const catalog = lookupModelCatalog(profile.model);
        return {
          ...profile,
          hasApiKey: Boolean(await getPersistedAiApiKey(normalizedWorkspaceId, profile.id)),
          resolvedContextWindow: profile.contextWindow ?? catalog?.contextWindow,
          resolvedMaxOutputTokens: profile.maxOutputTokens ?? catalog?.maxOutputTokens,
        };
      })
    );
    const activeProviderId = providers.find((p) => p.id === state.activeId)?.id ?? providers[0]?.id ?? null;
    return { providers, activeProviderId };
  }

  /** Resolved credentials for one saved profile (used by the test-connection route). */
  async getResolvedProvider(
    workspaceId: string | undefined,
    profileId: string
  ): Promise<(StoredAiProviderProfile & { apiKey?: string }) | undefined> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const state = await this.getProfileState(normalizedWorkspaceId);
    const profile = state.profiles.find((p) => p.id === profileId);
    if (!profile) {
      return undefined;
    }
    const apiKey = await getPersistedAiApiKey(normalizedWorkspaceId, profile.id);
    return { ...profile, apiKey };
  }

  async getPublicConfig(workspaceId?: string): Promise<AiAssistantConfig> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const [enabled, baseUrl, model, maxToolIterations, responseStyle, suggestFollowups, autoConfirm, showThinkingTrace, apiKey, providerState] =
      await Promise.all([
        this.getValue(normalizedWorkspaceId, KEY_ENABLED),
        this.getValue(normalizedWorkspaceId, KEY_BASE_URL),
        this.getValue(normalizedWorkspaceId, KEY_MODEL),
        this.getValue(normalizedWorkspaceId, KEY_MAX_TOOL_ITERATIONS),
        this.getValue(normalizedWorkspaceId, KEY_RESPONSE_STYLE),
        this.getValue(normalizedWorkspaceId, KEY_SUGGEST_FOLLOWUPS),
        this.getValue(normalizedWorkspaceId, KEY_AUTO_CONFIRM),
        this.getValue(normalizedWorkspaceId, KEY_SHOW_THINKING_TRACE),
        getPersistedAiApiKey(normalizedWorkspaceId),
        this.getProviders(normalizedWorkspaceId),
      ]);

    const activeProfile =
      providerState.providers.find((p) => p.id === providerState.activeProviderId) ?? providerState.providers[0];

    return {
      enabled: enabled === "true",
      provider: DEFAULT_PROVIDER,
      baseUrl: activeProfile?.baseUrl ?? (baseUrl?.trim() || DEFAULT_BASE_URL),
      model: activeProfile?.model ?? (model?.trim() || DEFAULT_MODEL),
      maxToolIterations: clampMaxToolIterations(Number(maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS)),
      responseStyle: responseStyle === "detailed" ? "detailed" : DEFAULT_RESPONSE_STYLE,
      suggestFollowups: suggestFollowups !== "false",
      autoConfirm: autoConfirm === "true",
      showThinkingTrace: showThinkingTrace !== "false",
      hasApiKey: activeProfile?.hasApiKey ?? Boolean(apiKey),
      providers: providerState.providers,
      activeProviderId: providerState.activeProviderId,
      maxOutputTokens: activeProfile?.resolvedMaxOutputTokens,
      contextWindow: activeProfile?.resolvedContextWindow,
      reasoningEffort: activeProfile?.reasoningEffort,
      temperature: activeProfile?.temperature,
    };
  }

  async getResolvedConfig(workspaceId?: string): Promise<ResolvedAiAssistantConfig> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const publicConfig = await this.getPublicConfig(normalizedWorkspaceId);
    const apiKey = publicConfig.activeProviderId
      ? await getPersistedAiApiKey(normalizedWorkspaceId, publicConfig.activeProviderId)
      : await getPersistedAiApiKey(normalizedWorkspaceId);
    return { ...publicConfig, apiKey };
  }

  async update(workspaceId: string | undefined, patch: UpdateAiAssistantConfigRequest): Promise<AiAssistantConfig> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);

    if (patch.enabled !== undefined) {
      await this.upsertValue(normalizedWorkspaceId, KEY_ENABLED, String(patch.enabled));
    }
    if (patch.provider !== undefined) {
      await this.upsertValue(normalizedWorkspaceId, KEY_PROVIDER, patch.provider);
    }
    if (patch.baseUrl !== undefined) {
      await this.upsertValue(normalizedWorkspaceId, KEY_BASE_URL, normalizeAiBaseUrl(patch.baseUrl));
    }
    if (patch.model !== undefined) {
      await this.upsertValue(normalizedWorkspaceId, KEY_MODEL, patch.model.trim());
    }
    if (patch.maxToolIterations !== undefined) {
      await this.upsertValue(
        normalizedWorkspaceId,
        KEY_MAX_TOOL_ITERATIONS,
        String(clampMaxToolIterations(patch.maxToolIterations))
      );
    }
    if (patch.responseStyle !== undefined) {
      await this.upsertValue(
        normalizedWorkspaceId,
        KEY_RESPONSE_STYLE,
        patch.responseStyle === "detailed" ? "detailed" : "concise"
      );
    }
    if (patch.suggestFollowups !== undefined) {
      await this.upsertValue(normalizedWorkspaceId, KEY_SUGGEST_FOLLOWUPS, String(patch.suggestFollowups));
    }
    if (patch.autoConfirm !== undefined) {
      await this.upsertValue(normalizedWorkspaceId, KEY_AUTO_CONFIRM, String(patch.autoConfirm));
    }
    if (patch.showThinkingTrace !== undefined) {
      await this.upsertValue(normalizedWorkspaceId, KEY_SHOW_THINKING_TRACE, String(patch.showThinkingTrace));
    }
    if (patch.apiKey?.trim()) {
      await storeAiApiKey(patch.apiKey, normalizedWorkspaceId);
    }

    const touchesProviders =
      patch.upsertProvider !== undefined ||
      patch.removeProviderId !== undefined ||
      patch.activeProviderId !== undefined;
    let state = touchesProviders ? await this.getProfileState(normalizedWorkspaceId) : undefined;

    if (patch.upsertProvider) {
      const input = patch.upsertProvider;
      const baseUrl = normalizeAiBaseUrl(input.baseUrl);
      const model = input.model.trim();
      if (!model) {
        throw new HttpError(400, "Provider model is required");
      }
      const name = input.name?.trim() || deriveProviderName(baseUrl);
      const profiles = state ? [...state.profiles] : [];
      const id = input.id?.trim() || randomUUID();
      const record: StoredAiProviderProfile = {
        id,
        name,
        baseUrl,
        model,
        maxOutputTokens: parsePositiveInt(input.maxOutputTokens ?? undefined),
        contextWindow: parsePositiveInt(input.contextWindow ?? undefined),
        reasoningEffort: parseReasoningEffort(input.reasoningEffort ?? undefined),
        temperature: parseTemperature(input.temperature ?? undefined),
      };
      const index = profiles.findIndex((p) => p.id === id);
      if (index >= 0) {
        profiles[index] = record;
      } else {
        profiles.push(record);
      }
      const activeId = state?.activeId ?? id;
      await this.saveProfiles(normalizedWorkspaceId, profiles, activeId);
      if (input.apiKey?.trim()) {
        await storeAiApiKey(input.apiKey, normalizedWorkspaceId, id);
      }
      state = { profiles, activeId, persisted: true };
    }

    if (patch.removeProviderId !== undefined) {
      const profiles = state?.profiles ?? [];
      if (!profiles.some((p) => p.id === patch.removeProviderId)) {
        throw new HttpError(404, "Provider not found");
      }
      const remaining = profiles.filter((p) => p.id !== patch.removeProviderId);
      const activeId =
        state?.activeId === patch.removeProviderId ? remaining[0]?.id ?? null : state?.activeId ?? null;
      await this.saveProfiles(normalizedWorkspaceId, remaining, activeId);
      await clearAiApiKey(normalizedWorkspaceId, patch.removeProviderId);
      state = { profiles: remaining, activeId, persisted: true };
    }

    if (patch.activeProviderId !== undefined) {
      const profiles = state?.profiles ?? (await this.getProfileState(normalizedWorkspaceId)).profiles;
      if (!profiles.some((p) => p.id === patch.activeProviderId)) {
        throw new HttpError(400, "Unknown provider");
      }
      await this.saveProfiles(normalizedWorkspaceId, profiles, patch.activeProviderId);
    }

    return this.getPublicConfig(normalizedWorkspaceId);
  }
}
