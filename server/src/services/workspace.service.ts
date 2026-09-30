import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { startCanonicalTasksIfEmpty } from "../db/canonical-start";
import { db, rawDb } from "../db/connection";
import { workspaces } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";

export const DEFAULT_WORKSPACE_ID = "default";

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeWorkspaceId(workspaceId?: string | null): string {
  const normalized = workspaceId?.trim();
  return normalized || DEFAULT_WORKSPACE_ID;
}

export class WorkspaceService {
  async ensureDefaultWorkspace(ownerAccountId?: string): Promise<string> {
    const now = nowIso();
    await db
      .insert(workspaces)
      .values({
        id: DEFAULT_WORKSPACE_ID,
        name: "Default Workspace",
        ownerAccountId: ownerAccountId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    if (ownerAccountId) {
      await this.setOwnerIfMissing(DEFAULT_WORKSPACE_ID, ownerAccountId);
    }

    return DEFAULT_WORKSPACE_ID;
  }

  async createWorkspaceForManager(ownerAccountId: string, displayName: string): Promise<string> {
    const now = nowIso();
    const id = `workspace_${randomUUID()}`;
    const name = `${displayName.trim() || ownerAccountId}'s Workspace`;
    await db.insert(workspaces).values({
      id,
      name,
      ownerAccountId,
      createdAt: now,
      updatedAt: now,
    });
    // docs/56 P3-00a: a brand-new workspace has nothing to backfill, so it starts canonical.
    startCanonicalTasksIfEmpty(rawDb, id);
    return id;
  }

  async assertWorkspaceExists(workspaceId?: string | null): Promise<string> {
    const normalized = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, normalized))
      .limit(1);

    if (!rows[0]) {
      throw new HttpError(400, "Workspace not found");
    }

    return normalized;
  }

  async setOwnerIfMissing(workspaceId: string, ownerAccountId: string): Promise<void> {
    const rows = await db
      .select({
        id: workspaces.id,
        ownerAccountId: workspaces.ownerAccountId,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    const row = rows[0];
    if (!row || row.ownerAccountId) {
      return;
    }

    await db
      .update(workspaces)
      .set({ ownerAccountId, updatedAt: nowIso() })
      .where(eq(workspaces.id, workspaceId));
  }
}
