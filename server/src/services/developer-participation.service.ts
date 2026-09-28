import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/connection";
import { appUsers } from "../db/schema";
import { normalizeWorkspaceId } from "./workspace.service";

/**
 * docs/56 P1-01: a developer `participates` only when an active developer
 * `app_users` row maps to them (`developer_account_id`). Returns the mapped
 * developer account ids for the workspace.
 */
export async function getParticipatingDeveloperIds(workspaceId?: string): Promise<Set<string>> {
  const rows = await db
    .select({ developerAccountId: appUsers.developerAccountId })
    .from(appUsers)
    .where(and(
      eq(appUsers.workspaceId, normalizeWorkspaceId(workspaceId)),
      eq(appUsers.role, "developer"),
      eq(appUsers.isActive, 1),
      isNotNull(appUsers.developerAccountId),
    ));
  return new Set(rows.flatMap((row) => (row.developerAccountId ? [row.developerAccountId] : [])));
}
