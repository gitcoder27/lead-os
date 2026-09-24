import { and, eq } from "drizzle-orm";
import { TASK_KEY_PATTERN, type TaskResolution, type Developer, type ManagerDeskStatus, type TrackerItemState } from "shared/types";
import { db, rawDb } from "../db/connection";
import { configTable, developers, managerDeskDays, managerDeskItems, taskKeyAliases, teamTrackerDays, teamTrackerItems } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { normalizeWorkspaceId } from "./workspace.service";
import { todayIsoDate } from "../utils/date";

export class TaskKeysService {
  async enabled(workspaceId?: string): Promise<boolean> {
    const rows = await db.select({ value: configTable.value }).from(configTable).where(and(
      eq(configTable.workspaceId, normalizeWorkspaceId(workspaceId)), eq(configTable.key, "tasks_phase1_enabled")
    )).limit(1);
    return rows[0]?.value === "true";
  }

  async assertEnabled(workspaceId?: string): Promise<void> {
    if (!(await this.enabled(workspaceId))) throw new HttpError(404, "Not Found");
  }

  allocate(workspaceId: string): string {
    if (!rawDb.inTransaction) throw new Error("Task keys must be allocated inside a transaction");
    const row = rawDb.prepare(`INSERT INTO task_key_sequences (workspace_id, next_value) VALUES (?, 2)
      ON CONFLICT(workspace_id) DO UPDATE SET next_value = next_value + 1
      RETURNING next_value - 1 AS value`).get(normalizeWorkspaceId(workspaceId)) as { value: number };
    return `T-${row.value}`;
  }

  async resolve(workspaceId: string, rawKey: string): Promise<string | null> {
    const match = TASK_KEY_PATTERN.exec(rawKey.trim());
    if (!match) return null;
    const key = `T-${Number(match[1])}`;
    const alias = await db.select({ taskKey: taskKeyAliases.taskKey }).from(taskKeyAliases).where(and(
      eq(taskKeyAliases.workspaceId, normalizeWorkspaceId(workspaceId)), eq(taskKeyAliases.aliasKey, key)
    )).limit(1);
    return alias[0]?.taskKey ?? key;
  }

  async resolveTask(workspaceId: string, rawKey: string): Promise<TaskResolution> {
    await this.assertEnabled(workspaceId);
    const key = await this.resolve(workspaceId, rawKey);
    if (!key) throw new HttpError(404, "Task not found");
    const scope = normalizeWorkspaceId(workspaceId);
    const desk = await db.select().from(managerDeskItems).where(and(eq(managerDeskItems.workspaceId, scope), eq(managerDeskItems.taskKey, key))).limit(1);
    const tracker = await db.select({ item: teamTrackerItems, day: teamTrackerDays }).from(teamTrackerItems)
      .innerJoin(teamTrackerDays, eq(teamTrackerItems.dayId, teamTrackerDays.id))
      .where(and(eq(teamTrackerItems.workspaceId, scope), eq(teamTrackerItems.taskKey, key)));
    tracker.sort((a, b) => b.day.date.localeCompare(a.day.date) || b.item.updatedAt.localeCompare(a.item.updatedAt) || b.item.id - a.item.id);
    const latest = tracker[0];
    if (!latest && !desk[0]) {
      const { TaskEventsService } = await import("./task-events.service");
      const events = new TaskEventsService(this);
      const any = await events.latestForKey(key, scope);
      if (!any) throw new HttpError(404, "Task not found");
      const created = any.type === "created" ? any : await events.latestForKey(key, scope, "created");
      const meta = created?.meta as { title?: string } | null;
      return { taskKey: key, requestedKey: rawKey.trim(), title: meta?.title ?? key, kind: "desk_only", date: todayIsoDate(new Date(any.occurredAt)), deleted: true };
    }
    const deskDay = desk[0] ? (await db.select().from(managerDeskDays).where(eq(managerDeskDays.id, desk[0].dayId)).limit(1))[0] : undefined;
    const developerRow = latest ? (await db.select().from(developers).where(and(eq(developers.workspaceId, scope), eq(developers.accountId, latest.day.developerAccountId))).limit(1))[0] : undefined;
    const developer: Developer | undefined = developerRow && { accountId: developerRow.accountId, displayName: developerRow.displayName, isActive: developerRow.isActive === 1, email: developerRow.email ?? undefined, avatarUrl: developerRow.avatarUrl ?? undefined };
    return {
      taskKey: key, requestedKey: rawKey.trim(), title: desk[0]?.title ?? latest!.item.title,
      kind: desk[0] && latest?.item.managerDeskItemId === desk[0].id ? "delegated" : latest ? "tracker_only" : "desk_only",
      trackerItemId: latest?.item.id, managerDeskItemId: desk[0]?.id, developer,
      date: latest?.day.date ?? deskDay!.date, state: latest?.item.state as TrackerItemState | undefined,
      status: desk[0]?.status as ManagerDeskStatus | undefined, updatedAt: latest?.item.updatedAt ?? desk[0]?.updatedAt, deleted: false,
    };
  }
}
