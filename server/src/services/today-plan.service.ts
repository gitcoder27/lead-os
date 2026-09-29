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
import { TaskService, type TaskPrincipal, type TaskRow } from "./task.service";

const OPEN: TaskStatus[] = ["open", "active", "blocked"];
/** Done-today rows shown in the wrap-up; the count is always the real total. */
const DONE_PREVIEW = 10;

export function addDaysToDate(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function taskTarget(taskKey: string, date: string): TodayActionTarget {
  return { type: "view", view: "tasks", taskKey, date };
}

function markDone(taskKey: string, date: string): TodayActionCommand {
  return { kind: "mark_done", label: "Done", target: taskTarget(taskKey, date), confirm: false, undoable: true };
}

function planItem(row: Pick<TaskRow, "taskKey" | "title" | "status" | "priority" | "scheduledOn" | "dueAt">, date: string, pinned: boolean): TodayPlanItem {
  const plan = taskPlanDate(row);
  return {
    taskKey: row.taskKey,
    title: row.title,
    status: row.status as TaskStatus,
    priority: row.priority === "high" ? "high" : "normal",
    scheduledOn: row.scheduledOn,
    dueAt: row.dueAt,
    overdue: plan.date !== null && plan.date < date,
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

  async build(principal: TaskPrincipal, date: string): Promise<TodayPlanFocus> {
    const tomorrow = addDaysToDate(date, 1);
    const planDefinition = builtinTaskViews(date).find((view) => view.id === "today")!.definition;
    // "Active" work belongs on the plan even without a date.
    const activeDefinition: TaskViewDefinition = {
      filters: { owner: "me", status: ["active"], later: false, waitingOn: false },
      sort: "scheduled",
    };
    const doneDefinition: TaskViewDefinition = {
      filters: { owner: "me", status: ["done"], closed: { from: date, to: date } },
      sort: "updated",
    };
    const inboxDefinition: TaskViewDefinition = { filters: { lane: "inbox" }, sort: "created" };

    const [planned, active, done, inboxCount, pinnedRows, tomorrowRows] = await Promise.all([
      this.views.run(principal, planDefinition, date),
      this.views.run(principal, activeDefinition, date),
      this.views.run(principal, doneDefinition, date),
      this.views.count(principal, inboxDefinition, date),
      this.taskService.top3Rows(principal.accountId, date, principal.workspaceId),
      this.taskService.top3Rows(principal.accountId, tomorrow, principal.workspaceId),
    ]);

    const pinnedOpen = pinnedRows.filter((row) => OPEN.includes(row.status as TaskStatus));
    const pinnedKeys = pinnedOpen.map((row) => row.taskKey);
    const pinnedSet = new Set(pinnedKeys);
    const seen = new Set<string>();
    const rest: TodayPlanItem[] = [];
    for (const task of [...planned, ...active]) {
      if (seen.has(task.taskKey) || pinnedSet.has(task.taskKey)) continue;
      seen.add(task.taskKey);
      rest.push(planItem(task, date, false));
    }
    // Overdue first, then by plan date — stable for equal dates.
    rest.sort((left, right) => Number(right.overdue) - Number(left.overdue));

    // The closed range keeps only tasks whose `closedAt` falls on `date`; a task
    // reopened later has no `closedAt` and drops out.
    const doneItems = done
      .filter((task) => task.closedAt)
      .sort((left, right) => right.closedAt!.localeCompare(left.closedAt!));

    return {
      date,
      items: [...pinnedOpen.map((row) => planItem(row, date, true)), ...rest],
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
        items: tomorrowRows.filter((row) => OPEN.includes(row.status as TaskStatus)).map((row) => planItem(row, date, true)),
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
