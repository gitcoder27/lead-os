import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AuthUser, TaskEvent, TaskInboxKind, TaskInboxReadRequest, TaskInboxResponse } from "shared/types";
import { db } from "../db/connection";
import { appUsers, taskInbox, tasks } from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { HttpError } from "../middleware/errorHandler";
import { SettingsService } from "./settings.service";
import { TaskEventsService } from "./task-events.service";
import { TaskKeysService } from "./task-keys.service";
import { normalizeWorkspaceId } from "./workspace.service";

export class TaskInboxService {
  private readonly settings = new SettingsService();
  private readonly keys = new TaskKeysService();
  private readonly events = new TaskEventsService();
  private async scope(user: AuthUser) {
    if (user.role !== "manager" && user.role !== "developer") throw new HttpError(403, "Workspace access required");
    const workspaceId = normalizeWorkspaceId(user.workspaceId);
    const [recipient] = await db
      .select()
      .from(appUsers)
      .where(
        and(
          eq(appUsers.workspaceId, workspaceId),
          eq(appUsers.username, user.username),
          eq(appUsers.role, user.role),
          eq(appUsers.isActive, 1),
        ),
      )
      .limit(1);
    if (!recipient || user.accountId !== (recipient.developerAccountId ?? recipient.username))
      throw new HttpError(401, "Account unavailable");
    const enabled =
      (await this.settings.getTeamMode(workspaceId)) === "collab" && (await this.keys.canonicalEnabled(workspaceId));
    const developerAccess = and(
      eq(tasks.ownerType, "developer"),
      eq(tasks.ownerId, user.accountId),
      sql`EXISTS (SELECT 1 FROM developers d WHERE d.workspace_id = ${workspaceId} AND d.account_id = ${user.accountId} AND d.is_active = 1)`,
    );
    const managerAccess = or(
      eq(tasks.trackedByManagerId, user.accountId),
      and(eq(tasks.ownerType, "manager"), eq(tasks.ownerId, user.accountId)),
      and(eq(tasks.ownerType, "developer"), isNull(tasks.trackedByManagerId)),
      sql`EXISTS (SELECT 1 FROM manager_self_links s WHERE s.workspace_id = ${workspaceId} AND s.manager_account_id = ${user.accountId} AND s.developer_account_id = ${tasks.ownerId} AND ${tasks.ownerType} = 'developer')`,
    );
    return {
      workspaceId,
      enabled,
      recipientId: recipient.id,
      taskAccess: user.role === "developer" ? developerAccess : managerAccess,
    };
  }

  async list(
    user: AuthUser,
    options: { cursor?: string; limit?: number; unreadOnly?: boolean } = {},
  ): Promise<TaskInboxResponse> {
    const scope = await this.scope(user);
    if (!scope.enabled) return { enabled: false, unreadCount: 0, events: [], nextCursor: null };
    const limit = Math.min(50, Math.max(1, options.limit ?? 20));
    const cursor = options.cursor === undefined ? undefined : Number(options.cursor);
    if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1))
      throw new HttpError(400, "Invalid cursor");
    const { rows, unreadCount } = await this.events.inboxPage(scope, { limit, cursor, unreadOnly: options.unreadOnly });
    const page = rows.slice(0, limit);
    const actorIds = [...new Set(page.flatMap((row) => (row.delivery.actorUserId ? [row.delivery.actorUserId] : [])))];
    const actors = actorIds.length
      ? await db
          .select({ id: appUsers.id, name: appUsers.displayName })
          .from(appUsers)
          .where(and(eq(appUsers.workspaceId, scope.workspaceId), inArray(appUsers.id, actorIds)))
      : [];
    return {
      enabled: true,
      unreadCount,
      events: page.map(({ delivery, event, task }) => ({
        id: delivery.id,
        eventId: event.id,
        taskKey: task.taskKey,
        title: task.title,
        kind: delivery.kind as TaskInboxKind,
        actorName:
          actors.find((actor) => actor.id === delivery.actorUserId)?.name ??
          (event.authorType === "developer" ? "Developer" : event.authorType === "system" ? "Workspace" : "Manager"),
        excerpt:
          event.body?.slice(0, 200) ??
          (delivery.kind === "blocker"
            ? "Status changed to blocked"
            : delivery.kind === "blocker_cleared"
              ? "Blocker cleared"
              : "Assignment changed"),
        occurredAt: event.occurredAt,
        readAt: delivery.readAt,
        href: `/t/${encodeURIComponent(task.taskKey)}?event=${event.id}`,
      })),
      nextCursor: rows.length > limit ? String(page.at(-1)!.delivery.id) : null,
    };
  }

  async markRead(user: AuthUser, input: TaskInboxReadRequest): Promise<{ success: true }> {
    if (
      !input.ids.length ||
      input.ids.length > 100 ||
      new Set(input.ids).size !== input.ids.length ||
      input.ids.some((id) => !Number.isSafeInteger(id) || id < 1)
    )
      throw new HttpError(400, "Choose 1–100 distinct updates");
    return runInTransaction(async () => {
      const scope = await this.scope(user);
      if (!scope.enabled) throw new HttpError(409, "Updates are available in collaborative mode");
      const found = await this.events.inboxDeliveries(scope, input.ids);
      if (found.length !== input.ids.length) throw new HttpError(404, "Update unavailable. Refresh the inbox.");
      await db
        .update(taskInbox)
        .set({ readAt: input.read ? sql`coalesce(${taskInbox.readAt}, ${new Date().toISOString()})` : null })
        .where(
          and(
            eq(taskInbox.workspaceId, scope.workspaceId),
            eq(taskInbox.recipientUserId, scope.recipientId),
            inArray(taskInbox.id, input.ids),
          ),
        );
      return { success: true };
    });
  }

  async targetEvent(user: AuthUser, eventId: number, taskKey: string): Promise<{ event: TaskEvent }> {
    const scope = await this.scope(user);
    if (!scope.enabled) throw new HttpError(404, "Update unavailable");
    const target = await this.events.inboxTarget(scope, eventId, taskKey);
    if (!target) throw new HttpError(404, "Update unavailable");
    const event = await this.events.get(eventId, {
      kind: user.role === "developer" ? "developer" : "manager",
      accountId: user.accountId,
      workspaceId: scope.workspaceId,
    });
    const actor = target.delivery.actorUserId
      ? (
          await db
            .select({ name: appUsers.displayName })
            .from(appUsers)
            .where(and(eq(appUsers.workspaceId, scope.workspaceId), eq(appUsers.id, target.delivery.actorUserId)))
            .limit(1)
        )[0]
      : undefined;
    return {
      event: actor ? { ...event, author: { ...event.author, displayName: actor.name } } : event,
    };
  }
}
