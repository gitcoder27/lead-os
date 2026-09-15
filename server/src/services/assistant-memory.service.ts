import { and, asc, eq } from "drizzle-orm";
import type { AssistantMemory } from "shared/types";
import { db } from "../db/connection";
import { assistantMemories } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { normalizeWorkspaceId } from "./workspace.service";

export const MAX_ASSISTANT_MEMORIES = 50;
export const MAX_ASSISTANT_MEMORY_CHARS = 300;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Manager-scoped durable memories for Copilot — short, confirmed facts and
 * preferences ("Priya prefers async updates") injected into the system prompt
 * tail so they shape every answer. Bounded hard: they ride in every prompt,
 * so count and length are both capped.
 */
export class AssistantMemoryService {
  async list(managerAccountId: string, workspaceId?: string): Promise<AssistantMemory[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(assistantMemories)
      .where(
        and(
          eq(assistantMemories.workspaceId, normalizedWorkspaceId),
          eq(assistantMemories.managerAccountId, managerAccountId)
        )
      )
      .orderBy(asc(assistantMemories.createdAt), asc(assistantMemories.id));
    return rows.map((row) => ({ id: row.id, text: row.text, createdAt: row.createdAt }));
  }

  /** Idempotent on exact repeats (case-insensitive) — re-saving the same fact is a no-op. */
  async add(managerAccountId: string, text: string, workspaceId?: string): Promise<AssistantMemory> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const trimmed = text.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      throw new HttpError(400, "Memory text is required");
    }
    if (trimmed.length > MAX_ASSISTANT_MEMORY_CHARS) {
      throw new HttpError(400, `Memory must be ${MAX_ASSISTANT_MEMORY_CHARS} characters or fewer`);
    }

    const existing = await this.list(managerAccountId, normalizedWorkspaceId);
    const duplicate = existing.find((memory) => memory.text.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) {
      return duplicate;
    }
    if (existing.length >= MAX_ASSISTANT_MEMORIES) {
      throw new HttpError(
        400,
        `Memory is full (${MAX_ASSISTANT_MEMORIES} entries) — remove some in Copilot settings`
      );
    }

    const now = nowIso();
    const rows = await db
      .insert(assistantMemories)
      .values({
        workspaceId: normalizedWorkspaceId,
        managerAccountId,
        text: trimmed,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0];
    if (!row) {
      throw new HttpError(500, "Failed to save memory");
    }
    return { id: row.id, text: row.text, createdAt: row.createdAt };
  }

  async remove(managerAccountId: string, id: number, workspaceId?: string): Promise<void> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    await db
      .delete(assistantMemories)
      .where(
        and(
          eq(assistantMemories.id, id),
          eq(assistantMemories.workspaceId, normalizedWorkspaceId),
          eq(assistantMemories.managerAccountId, managerAccountId)
        )
      );
  }

  async clear(managerAccountId: string, workspaceId?: string): Promise<void> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    await db
      .delete(assistantMemories)
      .where(
        and(
          eq(assistantMemories.workspaceId, normalizedWorkspaceId),
          eq(assistantMemories.managerAccountId, managerAccountId)
        )
      );
  }
}
