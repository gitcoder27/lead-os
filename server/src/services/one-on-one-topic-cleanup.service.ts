import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/connection";
import { runInTransaction } from "../db/transaction";
import { dayFocus, oneOnOneAgendaItems, oneOnOneSeries, tasks } from "../db/schema";
import { normalizeWorkspaceId } from "./workspace.service";
import { TaskEventsService } from "./task-events.service";
import { TaskService } from "./task.service";

const OPEN_STATUSES = ["open", "active", "blocked"];

export interface LegacyOneOnOneTopic {
  taskKey: string;
  title: string;
  status: string;
  developerAccountId: string;
  /** Manager who created the task and will own it after the move. */
  managerAccountId: string | null;
  createdAt: string;
}

export interface MoveResult {
  moved: string[];
  skipped: { taskKey: string; reason: string }[];
}

/**
 * docs/56 P0-S5 cleanup. Before the fix, 1:1 agenda topics (and default session
 * actions) were created as developer-owned tasks, so they showed up in the
 * developer's My Day, task events and Load. This lists the rows that still look
 * like that and moves the ones the manager picks to manager ownership.
 *
 * Deliberately not automatic: the agenda table cannot tell a topic from an
 * action, and an action may have been assigned to the developer on purpose.
 */
export class OneOnOneTopicCleanupService {
  private readonly tasks = new TaskService();
  private readonly events = new TaskEventsService();

  /**
   * Open, developer-owned tasks attached to that developer's own 1:1 agenda,
   * created by the 1:1 workspace (`created` event `meta.source = one_on_one`),
   * where the developer has authored no event: a developer who has commented
   * on or updated the task has engaged with it, so it is never a candidate.
   */
  async listCandidates(workspaceId?: string): Promise<LegacyOneOnOneTopic[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select({ task: tasks, seriesDeveloper: oneOnOneSeries.developerAccountId })
      .from(oneOnOneAgendaItems)
      .innerJoin(tasks, eq(tasks.id, oneOnOneAgendaItems.taskId))
      .innerJoin(oneOnOneSeries, eq(oneOnOneSeries.id, oneOnOneAgendaItems.seriesId))
      .where(
        and(
          eq(oneOnOneAgendaItems.workspaceId, scope),
          eq(tasks.workspaceId, scope),
          eq(tasks.ownerType, "developer"),
          inArray(tasks.status, OPEN_STATUSES),
          isNull(tasks.deletedAt),
        ),
      );
    const candidates = rows.filter(({ task, seriesDeveloper }) => task.ownerId === seriesDeveloper).map(({ task }) => task);
    if (!candidates.length) return [];

    const ids = [...new Set(candidates.map((task) => task.id))];
    const events = await this.events.historyForTasks(ids, scope);
    const fromOneOnOne = new Set<number>();
    const developerEngaged = new Set<number>();
    for (const event of events) {
      if (event.taskId === null) continue;
      if (event.authorType === "developer") developerEngaged.add(event.taskId);
      if (event.type === "created" && (JSON.parse(event.metaJson ?? "{}") as { source?: string }).source === "one_on_one") {
        fromOneOnOne.add(event.taskId);
      }
    }
    return ids
      .filter((id) => fromOneOnOne.has(id) && !developerEngaged.has(id))
      .map((id) => candidates.find((task) => task.id === id)!)
      .sort((a, b) => a.id - b.id)
      .map((task) => ({
        taskKey: task.taskKey,
        title: task.title,
        status: task.status,
        developerAccountId: task.ownerId!,
        managerAccountId: task.trackedByManagerId,
        createdAt: task.createdAt,
      }));
  }

  /**
   * Move the picked candidates to manager ownership (owner = the manager who
   * created them). Keys that are not current candidates are skipped, never
   * moved. Drops the developer's `day_focus` rows for the task so historical
   * day plans stop listing its title, and links the developer (person link) so
   * manager surfaces still tie the topic to them. One transaction.
   */
  async moveToManager(taskKeys: string[], workspaceId?: string): Promise<MoveResult> {
    const scope = normalizeWorkspaceId(workspaceId);
    return runInTransaction(async () => {
      const candidates = new Map((await this.listCandidates(scope)).map((entry) => [entry.taskKey, entry]));
      const result: MoveResult = { moved: [], skipped: [] };
      for (const raw of [...new Set(taskKeys.map((key) => key.trim().toUpperCase()))]) {
        const candidate = candidates.get(raw);
        if (!candidate) {
          result.skipped.push({ taskKey: raw, reason: "not a legacy 1:1 topic candidate" });
          continue;
        }
        if (!candidate.managerAccountId) {
          result.skipped.push({ taskKey: raw, reason: "no tracking manager recorded" });
          continue;
        }
        const principal = { type: "manager" as const, accountId: candidate.managerAccountId, workspaceId: scope };
        await this.tasks.update(raw, { ownerType: "manager", ownerId: candidate.managerAccountId }, principal);
        const row = (await this.tasks.getByKey(raw, scope))!;
        await db.delete(dayFocus).where(and(eq(dayFocus.workspaceId, scope), eq(dayFocus.taskId, row.id), eq(dayFocus.ownerType, "developer")));
        await this.tasks.addLink(raw, { kind: "person", ref: candidate.developerAccountId }, principal);
        result.moved.push(raw);
      }
      return result;
    });
  }
}
