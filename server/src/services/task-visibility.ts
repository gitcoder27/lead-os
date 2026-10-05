import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/connection";
import { tasks } from "../db/schema";
import type { TaskPrincipal } from "./task.service";
import { SelfIdentityService } from "./self-identity.service";
import { normalizeWorkspaceId } from "./workspace.service";

/** Same manager scope for lists, membership validation, and visible descendants. */
export const taskVisibilityPredicate = (principal: TaskPrincipal) => {
  if (principal.type === "developer") return and(eq(tasks.ownerType, "developer"), eq(tasks.ownerId, principal.accountId))!;
  const own = principal.selfDeveloperId ? sql` OR (${tasks.ownerType} = 'developer' AND ${tasks.ownerId} = ${principal.selfDeveloperId})` : sql``;
  return sql`(${tasks.trackedByManagerId} = ${principal.accountId} OR (${tasks.ownerType} = 'manager' AND ${tasks.ownerId} = ${principal.accountId}) OR ${tasks.ownerType} IS NULL${own})`;
};
export const visibleTaskRows = async (actor: TaskPrincipal) => {
  const selfDeveloperId = actor.selfDeveloperId ?? await new SelfIdentityService().linkedDeveloperId(actor.accountId, actor.workspaceId);
  return db.select().from(tasks).where(and(eq(tasks.workspaceId, normalizeWorkspaceId(actor.workspaceId)), isNull(tasks.deletedAt), taskVisibilityPredicate({ ...actor, selfDeveloperId: selfDeveloperId ?? undefined })));
};
