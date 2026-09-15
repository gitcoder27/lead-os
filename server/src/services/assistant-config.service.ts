import { and, eq } from "drizzle-orm";
import type {
  AiAssistantConfig,
  AiProvider,
  AssistantResponseStyle,
  UpdateAiAssistantConfigRequest,
} from "shared/types";
import { db } from "../db/connection";
import { configTable } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { getPersistedAiApiKey, storeAiApiKey } from "./assistant-credentials.service";
import { normalizeWorkspaceId } from "./workspace.service";

const KEY_ENABLED = "ai_assistant_enabled";
const KEY_PROVIDER = "ai_provider";
const KEY_BASE_URL = "ai_base_url";
const KEY_MODEL = "ai_model";
const KEY_MAX_TOOL_ITERATIONS = "ai_max_tool_iterations";
const KEY_RESPONSE_STYLE = "ai_response_style";
const KEY_SUGGEST_FOLLOWUPS = "ai_suggest_followups";

const DEFAULT_PROVIDER: AiProvider = "openai-compatible";
const DEFAULT_BASE_URL = "https://api.z.ai/api/paas/v4";
const DEFAULT_MODEL = "glm-5.3-flash";
const DEFAULT_MAX_TOOL_ITERATIONS = 6;
const DEFAULT_RESPONSE_STYLE: AssistantResponseStyle = "concise";

export type ResolvedAiAssistantConfig = AiAssistantConfig & { apiKey?: string };

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

  async getPublicConfig(workspaceId?: string): Promise<AiAssistantConfig> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const [enabled, baseUrl, model, maxToolIterations, responseStyle, suggestFollowups, apiKey] =
      await Promise.all([
        this.getValue(normalizedWorkspaceId, KEY_ENABLED),
        this.getValue(normalizedWorkspaceId, KEY_BASE_URL),
        this.getValue(normalizedWorkspaceId, KEY_MODEL),
        this.getValue(normalizedWorkspaceId, KEY_MAX_TOOL_ITERATIONS),
        this.getValue(normalizedWorkspaceId, KEY_RESPONSE_STYLE),
        this.getValue(normalizedWorkspaceId, KEY_SUGGEST_FOLLOWUPS),
        getPersistedAiApiKey(normalizedWorkspaceId),
      ]);

    return {
      enabled: enabled === "true",
      provider: DEFAULT_PROVIDER,
      baseUrl: baseUrl?.trim() || DEFAULT_BASE_URL,
      model: model?.trim() || DEFAULT_MODEL,
      maxToolIterations: clampMaxToolIterations(Number(maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS)),
      responseStyle: responseStyle === "detailed" ? "detailed" : DEFAULT_RESPONSE_STYLE,
      suggestFollowups: suggestFollowups !== "false",
      hasApiKey: Boolean(apiKey),
    };
  }

  async getResolvedConfig(workspaceId?: string): Promise<ResolvedAiAssistantConfig> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const [publicConfig, apiKey] = await Promise.all([
      this.getPublicConfig(normalizedWorkspaceId),
      getPersistedAiApiKey(normalizedWorkspaceId),
    ]);
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
    if (patch.apiKey?.trim()) {
      await storeAiApiKey(patch.apiKey, normalizedWorkspaceId);
    }

    return this.getPublicConfig(normalizedWorkspaceId);
  }
}
