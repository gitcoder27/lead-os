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
  async get(managerAccountId: string, workspaceId?: string): Promise<NavPreferences> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
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
    if (!row) {
      return {
        topNav: [...DEFAULT_NAV_PREFERENCES.topNav],
        moreNav: [...DEFAULT_NAV_PREFERENCES.moreNav],
      };
    }

    return sanitizeNavPreferences(parseStoredList(row.topNav), parseStoredList(row.moreNav));
  }

  async save(
    managerAccountId: string,
    input: SaveNavPreferencesPayload,
    workspaceId?: string
  ): Promise<NavPreferences> {
    if (!isCompleteNavPreferences(input)) {
      throw new HttpError(
        400,
        "Navigation preferences must place each page in the top navigation or More menu exactly once"
      );
    }

    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const now = nowIso();
    const topNav = JSON.stringify(input.topNav);
    const moreNav = JSON.stringify(input.moreNav);

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

    return { topNav: [...input.topNav], moreNav: [...input.moreNav] };
  }
}
