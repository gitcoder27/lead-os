import { appUsers, configTable } from "../../src/db/schema";
import { db } from "./db";

/**
 * docs/56 P1-02: put a workspace in `collab` and give each developer an active
 * developer login, so they `participate` and keep the check-in clock.
 */
export async function enableCollabParticipation(accountIds: string[], workspaceId = "default"): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(configTable).values({ workspaceId, key: "team_mode", value: "collab" })
    .onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: "collab" } });
  if (accountIds.length === 0) return;
  await db.insert(appUsers).values(accountIds.map((accountId) => ({
    workspaceId,
    username: `${workspaceId}-${accountId}-login`,
    displayName: accountId,
    passwordHash: "x",
    role: "developer",
    developerAccountId: accountId,
    createdAt: now,
    updatedAt: now,
  })));
}
