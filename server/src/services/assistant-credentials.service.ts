import { and, eq } from "drizzle-orm";
import { db } from "../db/connection";
import { configTable } from "../db/schema";
import { decryptSecret, encryptSecret } from "./secret-crypto";
import { normalizeWorkspaceId } from "./workspace.service";

const AI_API_KEY = "ai_api_key";

/**
 * Id of the provider profile synthesized from the original flat ai_* config keys.
 * It deliberately reuses the plain `ai_api_key` row so pre-profile installs keep working.
 */
export const DEFAULT_AI_PROFILE_ID = "default";

function apiKeyConfigKey(profileId?: string): string {
  return !profileId || profileId === DEFAULT_AI_PROFILE_ID ? AI_API_KEY : `ai_api_key:${profileId}`;
}

export async function getPersistedAiApiKey(
  workspaceId?: string,
  profileId?: string
): Promise<string | undefined> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const rows = await db
    .select()
    .from(configTable)
    .where(
      and(eq(configTable.workspaceId, normalizedWorkspaceId), eq(configTable.key, apiKeyConfigKey(profileId)))
    )
    .limit(1);
  const value = rows[0]?.value;
  return value ? decryptSecret(value) : undefined;
}

export async function storeAiApiKey(key: string, workspaceId?: string, profileId?: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) {
    return;
  }

  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const encrypted = encryptSecret(trimmed);
  const configKey = apiKeyConfigKey(profileId);
  await db
    .insert(configTable)
    .values({ workspaceId: normalizedWorkspaceId, key: configKey, value: encrypted })
    .onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: encrypted } });
}

export async function clearAiApiKey(workspaceId?: string, profileId?: string): Promise<void> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  await db
    .delete(configTable)
    .where(
      and(eq(configTable.workspaceId, normalizedWorkspaceId), eq(configTable.key, apiKeyConfigKey(profileId)))
    );
}
