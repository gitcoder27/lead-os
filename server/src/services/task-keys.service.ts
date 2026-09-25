import { and, eq } from "drizzle-orm";
import { TASK_KEY_PATTERN, type TaskResolution, type Developer, type ManagerDeskStatus, type TrackerItemState } from "shared/types";
import { db, rawDb } from "../db/connection";
import { configTable, developers, managerDeskDays, managerDeskItems, taskKeyAliases, taskLegacyMap, tasks, teamTrackerDays, teamTrackerItems } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { normalizeWorkspaceId } from "./workspace.service";
import { todayIsoDate } from "../utils/date";

export class TaskKeysService {
  async canonicalEnabled(workspaceId?: string): Promise<boolean> {
    const rows = await db.select({ value: configTable.value }).from(configTable).where(and(
      eq(configTable.workspaceId, normalizeWorkspaceId(workspaceId)), eq(configTable.key, "tasks_phase2_stage")
    )).limit(1);
    return ["2b", "2c", "2d"].includes(rows[0]?.value ?? "");
  }

  async enabled(workspaceId?: string): Promise<boolean> {
    const rows = await db.select({ value: configTable.value }).from(configTable).where(and(
      eq(configTable.workspaceId, normalizeWorkspaceId(workspaceId)), eq(configTable.key, "tasks_phase1_enabled")
    )).limit(1);
    return rows[0]?.value === "true";
  }

  async assertEnabled(workspaceId?: string): Promise<void> {
    if (!(await this.enabled(workspaceId))) throw new HttpError(404, "Not Found");
  }

  async stage(workspaceId?: string): Promise<string | undefined> {
    const rows = await db.select({ value: configTable.value }).from(configTable).where(and(
      eq(configTable.workspaceId, normalizeWorkspaceId(workspaceId)), eq(configTable.key, "tasks_phase2_stage")
    )).limit(1);
    return rows[0]?.value;
  }

  /** True once the Phase 2d contract has run for the workspace. */
  async contracted(workspaceId?: string): Promise<boolean> {
    return (await this.stage(workspaceId)) === "2d";
  }

  /**
   * Phase 2d contract: legacy write-only fields (task `note`, desk
   * `contextNote`) are no longer accepted by the surface APIs.
   */
  async assertLegacyFieldsAllowed(workspaceId?: string): Promise<void> {
    if (await this.contracted(workspaceId)) {
      throw new HttpError(400, "Legacy item fields are removed in Phase 2d; use task events");
    }
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
    if (await this.canonicalEnabled(scope)) {
      const task = (await db.select().from(tasks).where(and(eq(tasks.workspaceId, scope), eq(tasks.taskKey, key))).limit(1))[0];
      if (!task) throw new HttpError(404, "Task not found");
      const mappings = await db.select().from(taskLegacyMap).where(and(eq(taskLegacyMap.workspaceId, scope), eq(taskLegacyMap.taskId, task.id)));
      const trackerId = mappings.find((entry) => entry.sourceTable === "team_tracker_items" && ["canonical", "mirror"].includes(entry.role))?.sourceId ?? task.id;
      const deskId = mappings.find((entry) => entry.sourceTable === "manager_desk_items" && entry.role === "canonical")?.sourceId ?? task.id;
      const developerRow = task.ownerType === "developer" && task.ownerId ? (await db.select().from(developers).where(and(eq(developers.workspaceId, scope), eq(developers.accountId, task.ownerId))).limit(1))[0] : undefined;
      return {
        taskKey: key, requestedKey: rawKey.trim(), title: task.title, deleted: Boolean(task.deletedAt),
        kind: task.ownerType === "developer" ? task.trackedByManagerId ? "delegated" : "tracker_only" : "desk_only",
        date: task.scheduledOn ?? todayIsoDate(), trackerItemId: task.ownerType === "developer" ? trackerId : undefined,
        managerDeskItemId: task.trackedByManagerId || task.ownerType === "manager" ? deskId : undefined,
        state: ({ active: "in_progress", done: "done", dropped: "dropped" } as Record<string, TrackerItemState>)[task.status] ?? "planned",
        status: task.status === "active" ? "in_progress" : task.status === "blocked" ? "waiting" : task.status === "done" ? "done" : task.status === "dropped" ? "cancelled" : task.later ? "backlog" : "planned",
        updatedAt: task.updatedAt,
        developer: developerRow ? { accountId: developerRow.accountId, displayName: developerRow.displayName, isActive: developerRow.isActive === 1, email: developerRow.email ?? undefined, avatarUrl: developerRow.avatarUrl ?? undefined } : undefined,
      };
    }
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
