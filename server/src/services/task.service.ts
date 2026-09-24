import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/connection";
import { dayFocus, taskLegacyMap, taskLinks, tasks } from "../db/schema";
import { normalizeWorkspaceId } from "./workspace.service";
import { isoDatePart, todayIsoDate } from "../utils/date";

export type TaskRow = typeof tasks.$inferSelect;
export type TaskLinkRow = typeof taskLinks.$inferSelect;
export type DayFocusRow = typeof dayFocus.$inferSelect;

// Normalised projection row used by the Phase 2 parity harness (§2.2.13). The
// `state` field carries the tracker vocabulary so it can be compared directly
// against legacy team_tracker_items.state.
export interface TaskProjection {
  taskKey: string;
  title: string;
  status: string;
  state: string;
  ownerType: string | null;
  ownerId: string | null;
}

export function taskStatusToTrackerState(status: string): string {
  switch (status) {
    case "active": return "in_progress";
    case "done": return "done";
    case "dropped": return "dropped";
    default: return "planned"; // open + blocked surface as planned work
  }
}

export function taskStatusToDeskStatus(status: string, later: number): string {
  if (later && status === "open") return "backlog";
  switch (status) {
    case "active": return "in_progress";
    case "blocked": return "waiting";
    case "done": return "done";
    case "dropped": return "cancelled";
    default: return "planned";
  }
}

function toProjection(row: TaskRow): TaskProjection {
  return {
    taskKey: row.taskKey,
    title: row.title,
    status: row.status,
    state: taskStatusToTrackerState(row.status),
    ownerType: row.ownerType,
    ownerId: row.ownerId,
  };
}

/**
 * Phase 2 canonical read surface. Shadow-only in stage 2a: nothing routes here
 * until the write cutover (2b) and the surface cutovers (2c). The projections
 * mirror the legacy queries so the backfill's --verify parity check can compare
 * them field-by-field.
 */
export class TaskService {
  async getByKey(key: string, workspaceId?: string): Promise<TaskRow | undefined> {
    const rows = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId, normalizeWorkspaceId(workspaceId)),
      eq(tasks.taskKey, key)
    )).limit(1);
    return rows[0];
  }

  async getById(id: number, workspaceId?: string): Promise<TaskRow | undefined> {
    const rows = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId, normalizeWorkspaceId(workspaceId)),
      eq(tasks.id, id)
    )).limit(1);
    return rows[0];
  }

  async listLinks(taskIds: number[], workspaceId?: string): Promise<TaskLinkRow[]> {
    if (!taskIds.length) return [];
    return db.select().from(taskLinks).where(and(
      eq(taskLinks.workspaceId, normalizeWorkspaceId(workspaceId)),
      inArray(taskLinks.taskId, taskIds)
    ));
  }

  /**
   * Adapter lookup (§2.3.2): resolve a legacy surface id to a task. Returns the
   * legacy-mapped task id, or the raw id when it is already a post-cutover
   * tasks.id (the tasks sequence is seeded above every legacy id).
   */
  async resolveLegacyId(sourceTable: "team_tracker_items" | "manager_desk_items", sourceId: number, tasksSequenceSeed: number): Promise<number | null> {
    const mapped = await db.select({ taskId: taskLegacyMap.taskId }).from(taskLegacyMap).where(and(
      eq(taskLegacyMap.sourceTable, sourceTable),
      eq(taskLegacyMap.sourceId, sourceId)
    )).limit(1);
    if (mapped[0]) return mapped[0].taskId;
    return sourceId > tasksSequenceSeed ? sourceId : null;
  }

  /**
   * Developer board projection (live view parity): every open developer-owned
   * task, plus any task that has a day_focus row on `date` (covers items closed
   * on that day). Mirrors buildLiveDeveloperDays' latest-row-per-key result.
   */
  async projectDeveloperBoardDay(ownerId: string, date: string, workspaceId?: string): Promise<TaskProjection[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select({ task: tasks, focusDate: dayFocus.date }).from(tasks)
      .leftJoin(dayFocus, and(
        eq(dayFocus.taskId, tasks.id),
        eq(dayFocus.ownerType, "developer"),
        eq(dayFocus.ownerId, ownerId),
        eq(dayFocus.date, date)
      ))
      .where(and(
        eq(tasks.workspaceId, scope),
        eq(tasks.ownerType, "developer"),
        eq(tasks.ownerId, ownerId),
        isNull(tasks.deletedAt),
        sql`(${tasks.status} IN ('open','active','blocked') OR ${dayFocus.date} IS NOT NULL)`
      ));
    return rows.map((row) => toProjection(row.task));
  }

  /**
   * Developer history projection: the tasks present on that date, i.e. the
   * day_focus rows for the day. Mirrors buildHistoricalDeveloperDay.
   */
  async projectDeveloperHistoryDay(ownerId: string, date: string, workspaceId?: string): Promise<TaskProjection[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select({ task: tasks }).from(dayFocus)
      .innerJoin(tasks, eq(tasks.id, dayFocus.taskId))
      .where(and(
        eq(dayFocus.workspaceId, scope),
        eq(dayFocus.ownerType, "developer"),
        eq(dayFocus.ownerId, ownerId),
        eq(dayFocus.date, date),
        isNull(tasks.deletedAt)
      ))
      .orderBy(dayFocus.position, dayFocus.id);
    return rows.map((row) => toProjection(row.task));
  }

  /**
   * Desk live-day parity (buildLiveDayView): open items whose scheduled_on is
   * not after the date, Later items always, and items closed on that day.
   */
  async projectDeskDay(managerAccountId: string, date: string, workspaceId?: string): Promise<TaskProjection[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId, scope),
      eq(tasks.trackedByManagerId, managerAccountId),
      isNull(tasks.deletedAt),
      sql`(
        (${tasks.status} IN ('open','active','blocked') AND (${tasks.scheduledOn} IS NULL OR ${tasks.scheduledOn} <= ${date}))
        OR (${tasks.status} = 'open' AND ${tasks.later} = 1)
        OR (${tasks.closedAt} IS NOT NULL AND date(${tasks.closedAt}) = ${date})
      )`
    ));
    return rows.map(toProjection);
  }

  /**
   * getTodayItems parity: not closed, not deleted, tracked by the manager, and
   * either a due follow-up, an undecided meeting due by the date, or open work
   * scheduled on/before it (the carry-forward analogue).
   */
  async projectTodayItems(managerAccountId: string, date: string, workspaceId?: string): Promise<TaskProjection[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId, scope),
      eq(tasks.trackedByManagerId, managerAccountId),
      isNull(tasks.deletedAt),
      sql`${tasks.status} NOT IN ('done','dropped')`
    ));
    return rows.filter((row) => {
      const scheduledOn = row.scheduledOn ?? date;
      const isFollowUp = Boolean(row.followUpAt) || (row.labelsJson?.includes('"category:follow_up"') ?? false);
      const isDueFollowUp = isFollowUp && (!row.followUpAt || (isoDatePart(row.followUpAt) ?? date) <= date);
      const isMeeting = row.kind === "meeting" && !row.outcome?.trim() && scheduledOn <= date;
      const isCarryForward = !row.later && !isFollowUp && row.kind !== "meeting" && (
        scheduledOn < date ||
        Boolean(row.startsAt && (isoDatePart(row.startsAt) ?? date) < date) ||
        Boolean(row.endsAt && (isoDatePart(row.endsAt) ?? date) < date)
      );
      return isDueFollowUp || isMeeting || isCarryForward;
    }).map(toProjection);
  }

  /** Follow-ups predicate (§2.3.3 #7): follow_up_at set or category:follow_up. */
  async projectFollowUps(managerAccountId: string, workspaceId?: string): Promise<TaskProjection[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId, scope),
      eq(tasks.trackedByManagerId, managerAccountId),
      isNull(tasks.deletedAt),
      sql`(${tasks.followUpAt} IS NOT NULL OR ${tasks.labelsJson} LIKE '%"category:follow_up"%')`
    ));
    return rows.map(toProjection);
  }

  /** Used by verification and tests: count developer-owned actives per owner. */
  async activeCountsByDeveloper(workspaceId?: string): Promise<Map<string, number>> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select({ ownerId: tasks.ownerId, count: sql<number>`COUNT(*)` }).from(tasks)
      .where(and(
        eq(tasks.workspaceId, scope),
        eq(tasks.ownerType, "developer"),
        eq(tasks.status, "active"),
        isNull(tasks.deletedAt)
      ))
      .groupBy(tasks.ownerId);
    return new Map(rows.map((row) => [row.ownerId ?? "", row.count]));
  }

  async focusRowsFor(ownerType: string, ownerId: string, date: string, workspaceId?: string): Promise<DayFocusRow[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    return db.select().from(dayFocus).where(and(
      eq(dayFocus.workspaceId, scope),
      eq(dayFocus.ownerType, ownerType),
      eq(dayFocus.ownerId, ownerId),
      eq(dayFocus.date, date)
    )).orderBy(dayFocus.position, dayFocus.id);
  }

  today(): string {
    return todayIsoDate();
  }
}
