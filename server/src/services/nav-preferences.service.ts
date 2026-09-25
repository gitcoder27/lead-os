import { and, eq } from "drizzle-orm";
import {
  DEFAULT_NAV_PREFERENCES,
  isCompleteNavPreferences,
  sanitizeNavPreferences,
  type NavPreferences,
  type SaveNavPreferencesPayload,
} from "shared/types";
import { db } from "../db/connection";
import { userNavPreferences } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { TaskKeysService } from "./task-keys.service";
import { normalizeWorkspaceId } from "./workspace.service";

function nowIso(): string {
  return new Date().toISOString();
}

function parseStoredList(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
}

export class NavPreferencesService {
  private readonly keys = new TaskKeysService();

  async get(managerAccountId: string, workspaceId?: string): Promise<NavPreferences> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    // P3-D1: persisted `desk`/`tasks` entries are rewritten on read to the id
    // that matches this workspace's flag.
    const tasksNav = await this.keys.phase3Enabled(normalizedWorkspaceId);
    const rows = await db
      .select()
      .from(userNavPreferences)
      .where(
        and(
          eq(userNavPreferences.workspaceId, normalizedWorkspaceId),
          eq(userNavPreferences.managerAccountId, managerAccountId)
        )
      )
      .limit(1);

    const row = rows[0];
    const stored = row ? { topNav: parseStoredList(row.topNav), moreNav: parseStoredList(row.moreNav) } : DEFAULT_NAV_PREFERENCES;
    return sanitizeNavPreferences(stored.topNav, stored.moreNav, { tasksNav });
  }

  async save(
    managerAccountId: string,
    input: SaveNavPreferencesPayload,
    workspaceId?: string
  ): Promise<NavPreferences> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const tasksNav = await this.keys.phase3Enabled(normalizedWorkspaceId);
    if (!isCompleteNavPreferences(input, { tasksNav })) {
      throw new HttpError(
        400,
        "Navigation preferences must place each page in the top navigation or More menu exactly once"
      );
    }

    const now = nowIso();
    // Persist the canonical live id so a flag flip never leaves a stale alias.
    const sanitized = sanitizeNavPreferences(input.topNav, input.moreNav, { tasksNav });
    const topNav = JSON.stringify(sanitized.topNav);
    const moreNav = JSON.stringify(sanitized.moreNav);

    await db
      .insert(userNavPreferences)
      .values({
        workspaceId: normalizedWorkspaceId,
        managerAccountId,
        topNav,
        moreNav,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [userNavPreferences.workspaceId, userNavPreferences.managerAccountId],
        set: { topNav, moreNav, updatedAt: now },
      });

    return sanitized;
  }
}
