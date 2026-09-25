import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { TaskStatus } from "shared/types";
import { db } from "../db/connection";
import { issues, taskLinks, tasks } from "../db/schema";
import { todayIsoDate } from "../utils/date";
import type { TaskPrincipal } from "./task.service";
import { normalizeWorkspaceId } from "./workspace.service";

/** Days a closed task stays eligible for the "open in Jira" drift signal (§8.1). */
export const JIRA_DRIFT_CLOSED_WINDOW_DAYS = 7;

export type JiraDriftDirection = "jira_done_task_open" | "task_done_jira_open";

export interface JiraDriftEntry {
  taskId: number;
  taskKey: string;
  title: string;
  status: TaskStatus;
  /** Primary Jira link key (role = "primary", else the earliest link). */
  jiraKey: string;
  jiraStatusCategory: string;
  direction: JiraDriftDirection;
  closedAt: string | null;
}

function shiftDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Phase 3 (§8.1): read-only Jira reconciliation. For every task with a Jira
 * link, compare the synced `issues.status_category` against the canonical
 * task status using the primary link only:
 *
 * - `jira_done_task_open`: Jira resolved the issue while the task is still
 *   open/active/blocked in LeadOS.
 * - `task_done_jira_open`: the task closed (done) within the last 7 days but
 *   the Jira issue is not done.
 *
 * The signal never writes — the manager resolves the drift manually.
 */
export class JiraDriftService {
  async list(principal: TaskPrincipal, workspaceId?: string, today = todayIsoDate(), taskIds?: number[]): Promise<JiraDriftEntry[]> {
    const scope = normalizeWorkspaceId(workspaceId);
    const rows = await db.select({
      taskId: tasks.id,
      taskKey: tasks.taskKey,
      title: tasks.title,
      status: tasks.status,
      closedAt: tasks.closedAt,
      linkId: taskLinks.id,
      linkRole: taskLinks.role,
      jiraKey: taskLinks.ref,
      statusCategory: issues.statusCategory,
    })
      .from(taskLinks)
      .innerJoin(tasks, and(eq(tasks.id, taskLinks.taskId), eq(tasks.workspaceId, taskLinks.workspaceId)))
      .innerJoin(issues, and(eq(issues.jiraKey, taskLinks.ref), eq(issues.workspaceId, taskLinks.workspaceId)))
      .where(and(
        eq(taskLinks.workspaceId, scope),
        eq(taskLinks.kind, "jira"),
        isNull(tasks.deletedAt),
        taskIds ? (taskIds.length ? inArray(tasks.id, taskIds) : sql`0`) : undefined,
        principal.type === "developer"
          ? and(eq(tasks.ownerType, "developer"), eq(tasks.ownerId, principal.accountId))
          : sql`(${tasks.trackedByManagerId} = ${principal.accountId} OR (${tasks.ownerType} = 'manager' AND ${tasks.ownerId} = ${principal.accountId}) OR ${tasks.ownerType} IS NULL)`,
      ));

    // Primary link wins; absent a primary the earliest Jira link is used.
    const primaryByTask = new Map<number, (typeof rows)[number]>();
    for (const row of rows) {
      const current = primaryByTask.get(row.taskId);
      if (!current) {
        primaryByTask.set(row.taskId, row);
      } else if (row.linkRole === "primary" && current.linkRole !== "primary") {
        primaryByTask.set(row.taskId, row);
      } else if (row.linkRole === current.linkRole && row.linkId < current.linkId) {
        primaryByTask.set(row.taskId, row);
      }
    }

    const closedFloor = shiftDays(today, -JIRA_DRIFT_CLOSED_WINDOW_DAYS);
    const drift: JiraDriftEntry[] = [];
    for (const row of primaryByTask.values()) {
      const status = row.status as TaskStatus;
      if (row.statusCategory === "done" && (status === "open" || status === "active" || status === "blocked")) {
        drift.push({ taskId: row.taskId, taskKey: row.taskKey, title: row.title, status, jiraKey: row.jiraKey, jiraStatusCategory: row.statusCategory, direction: "jira_done_task_open", closedAt: row.closedAt });
      } else if (status === "done" && row.statusCategory !== "done" && row.closedAt && row.closedAt.slice(0, 10) >= closedFloor) {
        drift.push({ taskId: row.taskId, taskKey: row.taskKey, title: row.title, status, jiraKey: row.jiraKey, jiraStatusCategory: row.statusCategory, direction: "task_done_jira_open", closedAt: row.closedAt });
      }
    }
    return drift.sort((a, b) => a.taskKey.localeCompare(b.taskKey, "en", { numeric: true }));
  }
}
