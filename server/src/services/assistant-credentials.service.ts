import { and, eq } from "drizzle-orm";
import { db } from "../db/connection";
import { configTable } from "../db/schema";
import { decryptSecret, encryptSecret } from "./secret-crypto";
import { normalizeWorkspaceId } from "./workspace.service";

const AI_API_KEY = "ai_api_key";

export async function getPersistedAiApiKey(workspaceId?: string): Promise<string | undefined> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const rows = await db
    .select()
    .from(configTable)
    .where(and(eq(configTable.workspaceId, normalizedWorkspaceId), eq(configTable.key, AI_API_KEY)))
    .limit(1);
  const value = rows[0]?.value;
  return value ? decryptSecret(value) : undefined;
}

export async function storeAiApiKey(key: string, workspaceId?: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) {
    return;
  }

  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const encrypted = encryptSecret(trimmed);
  await db
    .insert(configTable)
    .values({ workspaceId: normalizedWorkspaceId, key: AI_API_KEY, value: encrypted })
    .onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: encrypted } });
}

export async function clearAiApiKey(workspaceId?: string): Promise<void> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  await db
    .delete(configTable)
    .where(and(eq(configTable.workspaceId, normalizedWorkspaceId), eq(configTable.key, AI_API_KEY)));
}
