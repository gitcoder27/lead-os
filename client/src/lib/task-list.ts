import { format, parseISO } from 'date-fns';
import type { CreateTaskRequest, ManagerTask, TaskStatus, TaskViewDefinition, UpdateTaskRequest } from '@/types';
import { getLocalIsoDate, shiftLocalIsoDate } from '@/lib/utils';
import type { TaskGroupContext, TaskViewGroupBucket } from '@/lib/task-views';

/**
 * docs/49: pure view logic for the Tasks list — plan dates, relative date
 * labels, implied-meta suppression, lingering rows, inline-add context, and
 * undo patches. Kept free of React so every rule is unit-testable.
 */

export const OPEN_STATUSES: readonly TaskStatus[] = ['open', 'active', 'blocked'];

export function isOpenStatus(status: TaskStatus): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

/** Local calendar date of an ISO timestamp (or a bare date). */
export function localDateOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : getLocalIsoDate(date);
}

/** docs/49 D1: the earlier of scheduledOn and the dueAt date; ties are the deadline. */
export function taskPlanDate(task: Pick<ManagerTask, 'scheduledOn' | 'dueAt'>): { date: string | null; source: 'due' | 'scheduled' | null } {
  const due = localDateOf(task.dueAt);
  if (due && (!task.scheduledOn || due <= task.scheduledOn)) return { date: due, source: 'due' };
  if (task.scheduledOn) return { date: task.scheduledOn, source: 'scheduled' };
  return { date: null, source: null };
}

function daysBetween(from: string, to: string): number {
  return Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / 86_400_000);
}

export type RelativeDateTone = 'default' | 'muted' | 'warning' | 'danger';

export interface RelativeTaskDate {
  label: string;
  tone: RelativeDateTone;
  /** Full date for the tooltip. */
  title: string;
}

/** docs/49 §5.1: the row's relative date label. */
export function relativeTaskDate(task: Pick<ManagerTask, 'scheduledOn' | 'dueAt' | 'status' | 'closedAt'>, today: string): RelativeTaskDate | null {
  if (!isOpenStatus(task.status) && task.closedAt) {
    const closed = localDateOf(task.closedAt)!;
    return { label: `Closed ${shortDay(closed, today)}`, tone: 'muted', title: `Closed ${format(parseISO(closed), 'EEE, MMM d, yyyy')}` };
  }
  const plan = taskPlanDate(task);
  if (!plan.date) return null;
  const title = `${plan.source === 'due' ? 'Due' : 'Scheduled'} ${format(parseISO(plan.date), 'EEE, MMM d, yyyy')}`;
  const diff = daysBetween(today, plan.date);
  if (diff < 0) {
    return { label: `${-diff}d overdue`, tone: plan.source === 'due' ? 'danger' : 'warning', title };
  }
  if (diff === 0) return { label: plan.source === 'due' ? 'Due today' : 'Today', tone: 'default', title };
  if (diff === 1) return { label: 'Tomorrow', tone: 'default', title };
  return { label: shortDay(plan.date, today), tone: 'muted', title };
}

function shortDay(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return 'today';
  if (diff >= -6 && diff <= 6) return format(parseISO(date), 'EEE');
  return date.slice(0, 4) === today.slice(0, 4) ? format(parseISO(date), 'MMM d') : format(parseISO(date), 'MMM d, yyyy');
}

/** Meeting start time (local HH:mm) when present. */
export function meetingTime(task: Pick<ManagerTask, 'kind' | 'startsAt'>): string | null {
  if (task.kind !== 'meeting' || !task.startsAt) return null;
  const date = new Date(task.startsAt);
  return Number.isNaN(date.getTime()) ? null : format(date, 'HH:mm');
}

/** docs/49 §5.2: hide meta the view already implies. */
export function impliedMeta(
  definition: TaskViewDefinition | undefined,
  context: TaskGroupContext,
  task: Pick<ManagerTask, 'scheduledOn' | 'dueAt' | 'status' | 'closedAt'>,
  today: string,
): { showOwner: boolean; showDate: boolean } {
  const owner = definition?.filters?.owner;
  const showOwner = !(owner === 'me' || owner === 'inbox' || context.mode === 'owner');
  const singleDay = context.mode === 'scheduled' && (context.bucket === 'Today' || context.bucket === 'Tomorrow');
  const tone = relativeTaskDate(task, today)?.tone;
  const showDate = !(singleDay && tone !== 'danger' && tone !== 'warning' && isOpenStatus(task.status));
  return { showOwner, showDate };
}

/** docs/49 D7: transient search over the loaded view. */
export function searchTasks<T extends ManagerTask>(tasks: T[], query: string | undefined): T[] {
  const needle = query?.trim().toLowerCase();
  if (!needle) return tasks;
  return tasks.filter((task) =>
    [task.title, task.taskKey, task.nextAction ?? '', ...task.labels, ...task.links.map((link) => link.ref)]
      .some((value) => value.toLowerCase().includes(needle)),
  );
}

// ── Lingering rows (docs/49 §8.1) ─────────────────────────────────────────

export interface LingerEntry {
  /** Snapshot shown when the task no longer comes back from the server. */
  task: ManagerTask;
  groupKey: string;
  groupLabel: string;
  groupIndex: number;
  context: TaskGroupContext;
  index: number;
}

export type ListTask = ManagerTask & { lingering?: boolean };

export interface RenderGroup extends Omit<TaskViewGroupBucket, 'tasks'> {
  tasks: ListTask[];
}

/** Record where each acted-on row sits right now so it can stay put. */
export function lingerEntriesFor(groups: RenderGroup[], tasks: ManagerTask[]): Map<string, LingerEntry> {
  const entries = new Map<string, LingerEntry>();
  for (const task of tasks) {
    groups.forEach((group, groupIndex) => {
      const index = group.tasks.findIndex((row) => row.taskKey === task.taskKey);
      if (index >= 0 && !entries.has(task.taskKey)) {
        entries.set(task.taskKey, { task, groupKey: group.key, groupLabel: group.label, groupIndex, context: group.context, index });
      }
    });
  }
  return entries;
}

/**
 * R1–R4: rows the user acted on stay in their original group and index until
 * focus moves. The fresh copy is shown when the server still returns the task;
 * otherwise the snapshot renders flagged `lingering`.
 */
export function applyLingering(groups: RenderGroup[], lingering: Map<string, LingerEntry>): RenderGroup[] {
  if (!lingering.size) return groups;
  const fresh = new Map<string, ManagerTask>();
  for (const group of groups) for (const task of group.tasks) fresh.set(task.taskKey, task);
  const result: RenderGroup[] = groups.map((group) => ({ ...group, tasks: group.tasks.filter((task) => !lingering.has(task.taskKey)) }));
  const entries = [...lingering.values()].sort((a, b) => a.groupIndex - b.groupIndex || a.index - b.index);
  for (const entry of entries) {
    let group = result.find((candidate) => candidate.key === entry.groupKey);
    if (!group) {
      group = { key: entry.groupKey, label: entry.groupLabel, context: entry.context, tasks: [] };
      result.splice(Math.min(entry.groupIndex, result.length), 0, group);
    }
    const current = fresh.get(entry.task.taskKey);
    const row: ListTask = current ? { ...current } : { ...entry.task, lingering: true };
    group.tasks.splice(Math.min(entry.index, group.tasks.length), 0, row);
  }
  return result;
}

// ── Actions ────────────────────────────────────────────────────────────────

/** Space/e: open-ish → done; done/dropped → open. */
export function toggledDoneStatus(status: TaskStatus): TaskStatus {
  return isOpenStatus(status) ? 'done' : 'open';
}

export type SchedulePreset = 'today' | 'tomorrow' | 'next-week' | 'later' | 'clear';

/** Monday after `today` (never today itself). */
export function nextMonday(today: string): string {
  const weekday = parseISO(today).getDay(); // 0 = Sunday
  const ahead = ((8 - weekday) % 7) || 7;
  return shiftLocalIsoDate(today, ahead);
}

export function scheduleChanges(preset: SchedulePreset, today: string): UpdateTaskRequest {
  switch (preset) {
    case 'today': return { scheduledOn: today, later: false };
    case 'tomorrow': return { scheduledOn: shiftLocalIsoDate(today, 1), later: false };
    case 'next-week': return { scheduledOn: nextMonday(today), later: false };
    case 'later': return { later: true };
    case 'clear': return { scheduledOn: null, later: false };
  }
}

/** Server-side side effects mirrored for optimistic patches. */
export function optimisticTask<T extends ManagerTask>(task: T, changes: UpdateTaskRequest, now = new Date().toISOString()): T {
  const next: T = { ...task, ...(changes as Partial<ManagerTask>) };
  if (changes.later === true && changes.scheduledOn === undefined) next.scheduledOn = null;
  const reassigned = changes.ownerType !== undefined && (changes.ownerType !== task.ownerType || changes.ownerId !== task.ownerId);
  if (reassigned && task.status === 'active' && changes.status === undefined) next.status = 'open';
  next.closedAt = isOpenStatus(next.status) ? null : task.closedAt ?? now;
  next.updatedAt = now;
  return next;
}

/**
 * Previous values for an undo — every field the change touched plus the
 * fields the server changes as a side effect (Later clears the date,
 * reassignment resets active → open).
 */
export function undoChanges(task: ManagerTask, changes: UpdateTaskRequest): UpdateTaskRequest {
  const fields = new Set(Object.keys(changes) as (keyof UpdateTaskRequest)[]);
  if (fields.has('later') || fields.has('scheduledOn')) { fields.add('later'); fields.add('scheduledOn'); }
  if (fields.has('ownerType') || fields.has('ownerId')) { fields.add('ownerType'); fields.add('ownerId'); fields.add('status'); }
  const undo: Record<string, unknown> = {};
  for (const field of fields) undo[field] = (task as unknown as Record<string, unknown>)[field];
  // "Later ⇒ no date": restoring a parked task must not also carry a date.
  if (undo.later === true) undo.scheduledOn = null;
  return undo as UpdateTaskRequest;
}

/** docs/49 §6.1: fields a new inline-added task inherits from its group/view. */
export function inlineAddDefaults(
  viewId: string | undefined,
  definition: TaskViewDefinition | undefined,
  context: TaskGroupContext,
  today: string,
): Partial<CreateTaskRequest> {
  const defaults: Partial<CreateTaskRequest> = {};
  const filters = definition?.filters ?? {};
  if (viewId === 'later' || filters.later === true) defaults.later = true;
  if (viewId === 'inbox' || filters.owner === 'inbox') { defaults.ownerType = null; defaults.ownerId = null; }
  if (Array.isArray(filters.owner) && filters.owner.length === 1) { defaults.ownerType = 'developer'; defaults.ownerId = filters.owner[0]!; }
  if (filters.kind === 'meeting') defaults.kind = 'meeting';
  if (filters.horizon === 'today') defaults.scheduledOn = today;
  if (filters.horizon === 'upcoming') defaults.scheduledOn = shiftLocalIsoDate(today, 1);
  switch (context.mode) {
    case 'scheduled': {
      const offsets: Record<string, number | null> = { Overdue: 0, Today: 0, Tomorrow: 1, 'Next 7 days': 2, Beyond: 8, Unscheduled: null };
      const offset = offsets[context.bucket];
      defaults.scheduledOn = offset === null || offset === undefined ? null : shiftLocalIsoDate(today, offset);
      break;
    }
    case 'owner':
      // Manager rows: the server fills in the creating manager's id.
      if (context.ownerType === 'manager') { defaults.ownerType = 'manager'; delete defaults.ownerId; }
      else { defaults.ownerType = context.ownerType; defaults.ownerId = context.ownerId; }
      break;
    case 'status':
      defaults.status = context.status;
      break;
    case 'label':
      if (context.label) defaults.labels = [context.label];
      break;
    default:
      break;
  }
  // Later ⇒ no date; developer-owned tasks cannot be Later.
  if (defaults.later) delete defaults.scheduledOn;
  if (defaults.ownerType === 'developer') delete defaults.later;
  return defaults;
}
