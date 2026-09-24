import { and, eq } from "drizzle-orm";
import { db } from "../db/connection";
import {
  configTable,
  dayFocus,
  managerDeskDays,
  managerDeskItems,
  managerDeskLinks,
  taskLegacyMap,
  taskLinks,
  tasks,
  teamTrackerDays,
  teamTrackerItems,
} from "../db/schema";
import { runInTransaction } from "../db/transaction";
import { todayIsoDate } from "../utils/date";
import { normalizeWorkspaceId } from "./workspace.service";

/**
 * `tasks:export-legacy` — the inverse of the Phase 2 backfill (§2.3.5).
 * Regenerates legacy Desk/Tracker rows from canonical `tasks` so the pre-2b
 * service code paths can run again after a rollback. Lossy by design (labels
 * beyond the first category, due_at, parent_id, day_focus history).
 */
interface PlannedDeskRow {
  taskKey: string;
  dayId: number;
  title: string;
  kind: string;
  category: string;
  status: string;
  priority: string;
  assigneeDeveloperAccountId: string | null;
  participants: string | null;
  nextAction: string | null;
  outcome: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  followUpAt: string | null;
  completedAt: string | null;
  createdByType: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  deskItemId?: number;
}

interface PlannedTrackerRow {
  taskKey: string;
  dayId: number;
  managerDeskItemId: number | null;
  title: string;
  state: string;
  jiraKey: string | null;
  relatedJiraKeys: string | null;
  note: string | null;
  createdByType: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

const taskToTrackerState = (status: string) =>
  ({ active: "in_progress", open: "planned", blocked: "planned", done: "done", dropped: "dropped" }[status] ?? "planned");

const taskToDeskStatus = (status: string, later: number) => {
  if (status === "done") return "done";
  if (status === "dropped") return "cancelled";
  if (status === "blocked") return "waiting";
  if (status === "active") return "in_progress";
  return later ? "backlog" : "planned";
};

function firstCategory(labelsJson: string | null): string {
  if (!labelsJson) return "other";
  try {
    const labels = JSON.parse(labelsJson) as string[];
    const category = labels.find((label) => label.startsWith("category:"));
    return category ? category.slice("category:".length) : "other";
  } catch {
    return "other";
  }
}

export class TaskPhase2ExportService {
  /**
   * Dry-run: compute the regenerated legacy rows without writing.
   * `existingDeskItemId` lets the test compare against the pre-backfill rows.
   */
  async plan(workspaceId: string) {
    const scope = normalizeWorkspaceId(workspaceId);
    const allTasks = await db.select().from(tasks).where(eq(tasks.workspaceId, scope));
    const links = await db.select().from(taskLinks).where(eq(taskLinks.workspaceId, scope));
    const focus = await db.select().from(dayFocus).where(eq(dayFocus.workspaceId, scope));
    const legacyMap = await db.select().from(taskLegacyMap).where(eq(taskLegacyMap.workspaceId, scope));
    const today = todayIsoDate();

    const deskRows: PlannedDeskRow[] = [];
    const trackerRows: PlannedTrackerRow[] = [];
    const linkRows: { taskKey: string; linkType: string; ref: string }[] = [];
    const deskIdByTask = new Map<number, number>();

    for (const task of allTasks) {
      const mappedDesk = legacyMap.find((row) => row.taskId === task.id && row.sourceTable === "manager_desk_items" && row.role === "canonical");
      const wantsDesk = Boolean(task.trackedByManagerId) || task.ownerType === "manager" || task.ownerType === null;
      const wantsTracker = task.ownerType === "developer";
      if (!wantsDesk && !wantsTracker) continue;

      if (wantsDesk) {
        deskRows.push({
          taskKey: task.taskKey,
          dayId: -1, // resolved at apply time from scheduledOn
          title: task.title,
          kind: task.kind === "meeting" ? "meeting" : "action",
          category: firstCategory(task.labelsJson),
          status: taskToDeskStatus(task.status, task.later),
          priority: task.priority === "high" ? "high" : "medium",
          assigneeDeveloperAccountId: task.ownerType === "developer" ? task.ownerId : null,
          participants: task.participants,
          nextAction: task.nextAction,
          outcome: task.outcome,
          plannedStartAt: task.startsAt,
          plannedEndAt: task.endsAt,
          followUpAt: task.followUpAt,
          completedAt: task.closedAt,
          createdByType: task.createdByType,
          createdById: task.createdById,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          deskItemId: mappedDesk?.sourceId,
        });
        if (mappedDesk) deskIdByTask.set(task.id, mappedDesk.sourceId);
      }
      if (wantsTracker && task.ownerId) {
        const jira = links.filter((link) => link.taskId === task.id && link.kind === "jira");
        const primary = jira.find((link) => link.role === "primary") ?? jira[0];
        trackerRows.push({
          taskKey: task.taskKey,
          dayId: -1,
          managerDeskItemId: wantsDesk ? (mappedDesk?.sourceId ?? -1) : null,
          title: task.title,
          state: taskToTrackerState(task.status),
          jiraKey: primary?.ref ?? null,
          relatedJiraKeys: jira.length > 1 ? JSON.stringify(jira.filter((link) => link !== primary).map((link) => link.ref)) : null,
          note: null,
          createdByType: task.createdByType,
          createdById: task.createdById,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        });
      }
      for (const link of links.filter((row) => row.taskId === task.id && (wantsDesk || wantsTracker))) {
        linkRows.push({
          taskKey: task.taskKey,
          linkType: link.kind === "jira" ? "issue" : link.kind === "person" ? "developer" : "external_group",
          ref: link.ref,
        });
      }
    }
    return { workspaceId: scope, deskRows, trackerRows, linkRows };
  }

  /** Apply: wipe the legacy rows for the workspace and regenerate from tasks. */
  async apply(workspaceId: string): Promise<{ deskRows: number; trackerRows: number; links: number }> {
    const scope = normalizeWorkspaceId(workspaceId);
    const planned = await this.plan(scope);
    const today = todayIsoDate();
    return runInTransaction(async () => {
      await db.delete(managerDeskLinks).where(eq(managerDeskLinks.workspaceId, scope));
      await db.delete(teamTrackerItems).where(eq(teamTrackerItems.workspaceId, scope));
      await db.delete(managerDeskItems).where(eq(managerDeskItems.workspaceId, scope));

      const deskDayIds = new Map<string, number>();
      const trackerDayIds = new Map<string, number>();
      const ensureDeskDay = async (date: string, manager: string) => {
        const key = `${date}|${manager}`;
        const existing = deskDayIds.get(key);
        if (existing) return existing;
        const found = await db.select().from(managerDeskDays).where(and(
          eq(managerDeskDays.workspaceId, scope), eq(managerDeskDays.date, date), eq(managerDeskDays.managerAccountId, manager)
        )).limit(1);
        const id = found[0]?.id ?? (await db.insert(managerDeskDays).values({ workspaceId: scope, date, managerAccountId: manager, createdAt: today, updatedAt: today }).returning({ id: managerDeskDays.id }))[0]!.id;
        deskDayIds.set(key, id);
        return id;
      };
      const ensureTrackerDay = async (date: string, developer: string) => {
        const key = `${date}|${developer}`;
        const existing = trackerDayIds.get(key);
        if (existing) return existing;
        const found = await db.select().from(teamTrackerDays).where(and(
          eq(teamTrackerDays.workspaceId, scope), eq(teamTrackerDays.date, date), eq(teamTrackerDays.developerAccountId, developer)
        )).limit(1);
        const id = found[0]?.id ?? (await db.insert(teamTrackerDays).values({ workspaceId: scope, date, developerAccountId: developer, createdAt: today, updatedAt: today }).returning({ id: teamTrackerDays.id }))[0]!.id;
        trackerDayIds.set(key, id);
        return id;
      };

      const deskIdByKey = new Map<string, number>();
      const taskByKey = new Map((await db.select().from(tasks).where(eq(tasks.workspaceId, scope))).map((row) => [row.taskKey, row]));
      for (const row of planned.deskRows) {
        const task = taskByKey.get(row.taskKey)!;
        const manager = task.trackedByManagerId ?? task.ownerId ?? "unknown";
        const dayId = await ensureDeskDay(task.scheduledOn ?? today, manager);
        const inserted = await db.insert(managerDeskItems).values({
          workspaceId: scope, dayId, taskKey: row.taskKey,
          createdByType: row.createdByType, createdById: row.createdById,
          assigneeDeveloperAccountId: row.assigneeDeveloperAccountId,
          title: row.title, kind: row.kind, category: row.category, status: row.status, priority: row.priority,
          participants: row.participants, nextAction: row.nextAction, outcome: row.outcome,
          plannedStartAt: row.plannedStartAt, plannedEndAt: row.plannedEndAt, followUpAt: row.followUpAt,
          completedAt: row.completedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
        }).returning({ id: managerDeskItems.id });
        deskIdByKey.set(row.taskKey, inserted[0]!.id);
      }
      for (const row of planned.trackerRows) {
        const task = taskByKey.get(row.taskKey)!;
        const ownerId = task.ownerId ?? "unknown";
        const focusDates = (await db.select({ date: dayFocus.date }).from(dayFocus).where(and(
          eq(dayFocus.workspaceId, scope), eq(dayFocus.taskId, task.id), eq(dayFocus.ownerId, ownerId)
        ))).map((r) => r.date);
        const dayId = await ensureTrackerDay(focusDates.sort().at(-1) ?? today, ownerId);
        await db.insert(teamTrackerItems).values({
          workspaceId: scope, dayId, taskKey: row.taskKey,
          managerDeskItemId: deskIdByKey.get(row.taskKey) ?? null,
          itemType: row.jiraKey ? "jira" : "custom",
          jiraKey: row.jiraKey, relatedJiraKeys: row.relatedJiraKeys,
          title: row.title, state: row.state, note: row.note,
          createdByType: row.createdByType, createdById: row.createdById,
          createdAt: row.createdAt, updatedAt: row.updatedAt,
          completedAt: row.state === "done" ? task.closedAt : null,
        });
      }
      for (const link of planned.linkRows) {
        const itemId = deskIdByKey.get(link.taskKey);
        if (!itemId) continue;
        await db.insert(managerDeskLinks).values({
          workspaceId: scope, itemId,
          linkType: link.linkType,
          issueKey: link.linkType === "issue" ? link.ref : null,
          developerAccountId: link.linkType === "developer" ? link.ref : null,
          externalLabel: link.linkType === "external_group" ? link.ref : null,
          createdAt: today,
        });
      }
      await db.insert(configTable).values({ workspaceId: scope, key: "tasks_phase2_stage", value: "rolled_back" })
        .onConflictDoUpdate({ target: [configTable.workspaceId, configTable.key], set: { value: "rolled_back" } });
      return { deskRows: planned.deskRows.length, trackerRows: planned.trackerRows.length, links: planned.linkRows.length };
    });
  }
}
