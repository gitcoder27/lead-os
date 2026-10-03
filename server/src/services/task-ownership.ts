import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/connection";
import { appUsers } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import type { TaskPrincipal } from "./task.service";
import { normalizeWorkspaceId } from "./workspace.service";

/** Manager ownership uses the session account ID, never an unrelated roster ID. */
export const assertManagerTaskOwner = async (
  ownerType: string | null,
  ownerId: string | null,
  principal: TaskPrincipal,
): Promise<void> => {
  if (ownerType !== "manager" || !ownerId) return;
  // The initiating principal is already authenticated. This also preserves service callers.
  if (principal.type !== "developer" && ownerId === principal.accountId) return;
  const [owner] = await db.select({ id: appUsers.id }).from(appUsers).where(and(
    eq(appUsers.workspaceId, normalizeWorkspaceId(principal.workspaceId)),
    eq(appUsers.role, "manager"),
    eq(appUsers.isActive, 1),
    sql`COALESCE(${appUsers.developerAccountId}, ${appUsers.username}) = ${ownerId}`,
  )).limit(1);
  if (owner) return;
  throw new HttpError(400, `Manager owner not found in this workspace. For your own task, set ownerType="manager" and omit ownerId (your account is "${principal.accountId}"). To assign a roster member, use ownerType="developer" and their account ID.`);
};
