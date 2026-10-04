import type {
  TaskViewDefinition,
  TodayActionCommand,
  TodayActionItem,
  TodayActionTarget,
  TodayPlanFocus,
  TodayPlanItem,
  TaskStatus,
} from "shared/types";
import { builtinTaskViews, TaskViewsService, taskPlanDate } from "./task-views.service";
import { serverTimeZone, toZonedIsoDay } from "./today-clock";
import { TaskService, type TaskPrincipal, type TaskRow } from "./task.service";

const OPEN: TaskStatus[] = ["open", "active", "blocked"];
/** Done-today rows shown in the wrap-up; the count is always the real total. */
const DONE_PREVIEW = 10;

export function addDaysToDate(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A pin outlives later edits, so it is re-checked on every read: only my own open task that is not
 * parked or waiting on someone belongs on my plan. (Un-pinned it is just gone; the pin row stays.)
 */
export function stillMine(row: TaskRow, principal: TaskPrincipal): boolean {
  return OPEN.includes(row.status as TaskStatus)
    && row.ownerType === "manager"
    && row.ownerId === principal.accountId
    && row.later !== 1
    && row.waitingOnType === null;
}

function taskTarget(taskKey: string, date: string): TodayActionTarget {
  return { type: "view", view: "tasks", taskKey, date };
}

function markDone(taskKey: string, date: string): TodayActionCommand {
  return { kind: "mark_done", label: "Done", target: taskTarget(taskKey, date), confirm: false, undoable: true };
}

function planItem(row: Pick<TaskRow, "taskKey" | "title" | "status" | "priority" | "scheduledOn" | "dueAt" | "kind">, date: string, pinned: boolean, tz: string): TodayPlanItem {
  const plan = taskPlanDate(row, tz);
  return {
    taskKey: row.taskKey,
    title: row.title,
    status: row.status as TaskStatus,
    priority: row.priority === "high" ? "high" : "normal",
    scheduledOn: row.scheduledOn,
    dueAt: row.dueAt,
    ...(row.kind === "meeting" ? { kind: "meeting" as const } : {}),
    // docs/56 UX-08: meetings are never overdue.
    overdue: row.kind !== "meeting" && plan.date !== null && plan.date < date,
    pinned,
    target: taskTarget(row.taskKey, date),
    primaryAction: markDone(row.taskKey, date),
  };
}

/**
 * docs/57 §6 (P3-01): the manager's own plan for the day, the day's pins, real
 * completions and tomorrow's pins. Everything reads the canonical task tables,
 * so it survives reloads and shows the same on every device.
 */
export class TodayPlanService {
  constructor(
    private readonly views = new TaskViewsService(),
    private readonly taskService = new TaskService(),
  ) {}

  /** `tz` is the manager's zone: "overdue" and "done today" are judged on their calendar day, not the server's. */
  async build(principal: TaskPrincipal, date: string, tz: string = serverTimeZone()): Promise<TodayPlanFocus> {
    const tomorrow = addDaysToDate(date, 1);
    const planDefinition = builtinTaskViews(date).find((view) => view.id === "today")!.definition;
    // "Active" work belongs on the plan even without a date.
    const activeDefinition: TaskViewDefinition = {
      filters: { owner: "me", status: ["active"], later: false, waitingOn: false },
      sort: "scheduled",
    };
    const doneDefinition: TaskViewDefinition = {
      // Widened a day each side: the view buckets `closedAt` in the server zone; the exact day is cut below.
      filters: { owner: "me", status: ["done"], closed: { from: addDaysToDate(date, -1), to: tomorrow } },
      sort: "updated",
    };
    const inboxDefinition: TaskViewDefinition = { filters: { lane: "inbox" }, sort: "created" };

    const [planned, active, done, inboxCount, pinnedRows, tomorrowRows] = await Promise.all([
      this.views.run(principal, planDefinition, date, tz),
      this.views.run(principal, activeDefinition, date, tz),
      this.views.run(principal, doneDefinition, date, tz),
      this.views.count(principal, inboxDefinition, date, tz),
      this.taskService.top3Rows(principal.accountId, date, principal.workspaceId),
      this.taskService.top3Rows(principal.accountId, tomorrow, principal.workspaceId),
    ]);

    const pinnedOpen = pinnedRows.filter((row) => stillMine(row, principal));
    const pinnedKeys = pinnedOpen.map((row) => row.taskKey);
    const pinnedSet = new Set(pinnedKeys);
    const seen = new Set<string>();
    const rest: TodayPlanItem[] = [];
    for (const task of [...planned, ...active]) {
      if (seen.has(task.taskKey) || pinnedSet.has(task.taskKey)) continue;
      seen.add(task.taskKey);
      rest.push(planItem(task, date, false, tz));
    }
    // Overdue first, then by plan date — stable for equal dates.
    rest.sort((left, right) => Number(right.overdue) - Number(left.overdue));

    // The closed range keeps only tasks whose `closedAt` falls on `date`; a task
    // reopened later has no `closedAt` and drops out.
    const doneItems = done
      .filter((task) => task.closedAt && toZonedIsoDay(task.closedAt, tz) === date)
      .sort((left, right) => right.closedAt!.localeCompare(left.closedAt!));

    return {
      date,
      items: [...pinnedOpen.map((row) => planItem(row, date, true, tz)), ...rest],
      top3: pinnedKeys,
      inboxCount,
      doneToday: {
        count: doneItems.length,
        items: doneItems.slice(0, DONE_PREVIEW).map((task) => ({
          taskKey: task.taskKey,
          title: task.title,
          closedAt: task.closedAt!,
          target: taskTarget(task.taskKey, date),
        })),
      },
      tomorrowTop3: {
        date: tomorrow,
        items: tomorrowRows.filter((row) => stillMine(row, principal)).map((row) => planItem(row, date, true, tz)),
      },
    };
  }
}

/** Queue rows for the pinned tasks: above every other row, in pin order. */
export function buildTopThreeActions(plan: TodayPlanFocus): TodayActionItem[] {
  return plan.items.filter((item) => item.pinned).map((item, index) => ({
    id: `today-top3-${item.taskKey}`,
    type: "top_three" as const,
    title: item.title,
    context: item.overdue ? "Top 3 · carried from earlier" : "Top 3 for today",
    signal: `Top ${index + 1}`,
    severity: item.priority === "high" ? "warning" as const : "info" as const,
    // Above the standup row (99) and everything else; pin order breaks ties.
    priority: 120 - index,
    group: "now" as const,
    target: item.target,
    primaryAction: item.primaryAction,
    secondaryActions: [{ kind: "open" as const, label: "Open", target: item.target }],
  }));
}
