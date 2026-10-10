import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { startCanonicalTasksIfEmpty } from "../db/canonical-start";
import { db, rawDb } from "../db/connection";
import { workspaces } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";

import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from "../workspace-scope";
export { DEFAULT_WORKSPACE_ID, INSTALL_WORKSPACE_ID, normalizeWorkspaceId } from "../workspace-scope";

function nowIso(): string {
  return new Date().toISOString();
}

export class WorkspaceService {
  ensureDefaultWorkspace(ownerAccountId?: string): string {
    const now = nowIso();
    db
      .insert(workspaces)
      .values({
        id: DEFAULT_WORKSPACE_ID,
        name: "Default Workspace",
        ownerAccountId: ownerAccountId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing().run();

    if (ownerAccountId) {
      this.setOwnerIfMissing(DEFAULT_WORKSPACE_ID, ownerAccountId);
    }

    return DEFAULT_WORKSPACE_ID;
  }

  createWorkspaceForManager(ownerAccountId: string, displayName: string): string {
    const now = nowIso();
    const id = `workspace_${randomUUID()}`;
    const name = `${displayName.trim() || ownerAccountId}'s Workspace`;
    db.insert(workspaces).values({
      id,
      name,
      ownerAccountId,
      createdAt: now,
      updatedAt: now,
    }).run();
    // docs/56 P3-00a: a brand-new workspace has nothing to backfill, so it starts canonical.
    startCanonicalTasksIfEmpty(rawDb, id);
    return id;
  }

  assertWorkspaceExists(workspaceId?: string | null): string {
    const normalized = normalizeWorkspaceId(workspaceId);
    const rows = db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, normalized))
      .limit(1).all();

    if (!rows[0]) {
      throw new HttpError(400, "Workspace not found");
    }

    return normalized;
  }

  setOwnerIfMissing(workspaceId: string, ownerAccountId: string): void {
    const rows = db
      .select({
        id: workspaces.id,
        ownerAccountId: workspaces.ownerAccountId,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1).all();

    const row = rows[0];
    if (!row || row.ownerAccountId) {
      return;
    }

    db
      .update(workspaces)
      .set({ ownerAccountId, updatedAt: nowIso() })
      .where(eq(workspaces.id, workspaceId)).run();
  }
}
