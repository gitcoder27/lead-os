import { format, parseISO } from 'date-fns';
import type { CaptureDefaults } from 'shared/capture-grammar';
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

/**
 * docs/57 §4 (P3-03): Waiting-lens row chips — aging ("Waiting 6d") and the
 * check-by date ("Check Fri", "Check today", "Check 2d late"). Check-by is
 * `followUpAt`, compared as a local date.
 */
export function waitingChips(
  task: Pick<ManagerTask, 'followUpAt' | 'status'> & { signals?: { waitingDays?: number | null } },
  today: string,
): { aging: string | null; check: { label: string; tone: 'danger' | 'warning' | 'muted' } | null } {
  if (!isOpenStatus(task.status)) return { aging: null, check: null };
  const days = task.signals?.waitingDays;
  // docs/56 UX-09: "Waiting since today", never "Waiting 0d".
  const aging = days === null || days === undefined ? null : days === 0 ? 'Waiting since today' : `Waiting ${days}d`;
  const due = localDateOf(task.followUpAt);
  if (!due) return { aging, check: null };
  const diff = daysBetween(today, due);
  const check = diff < 0 ? { label: `Check ${-diff}d late`, tone: 'danger' as const }
    : diff === 0 ? { label: 'Check today', tone: 'warning' as const }
      : { label: `Check ${shortDay(due, today)}`, tone: 'muted' as const };
  return { aging, check };
}

export type RelativeDateTone = 'default' | 'muted' | 'warning' | 'danger';

/**
 * docs/51 D1: how loud an overdue date reads. 1 = a nudge (tinted text),
 * 2 = a tinted pill, 3 = an outlined pill. Scheduled slips climb 1 → 3 with
 * age (3d, 7d); a missed deadline starts at 2 — it is never just a nudge.
 */
export type OverdueLevel = 1 | 2 | 3;

export function overdueLevel(days: number, source: 'due' | 'scheduled' | null): OverdueLevel {
  const byAge: OverdueLevel = days >= 7 ? 3 : days >= 3 ? 2 : 1;
  return source === 'due' && byAge === 1 ? 2 : byAge;
}

/** docs/51 D1: red only for a missed deadline (`dueAt`); a slipped plan date is amber. */
export function overdueTone(source: 'due' | 'scheduled' | null): 'danger' | 'warning' {
  return source === 'due' ? 'danger' : 'warning';
}

export interface RelativeTaskDate {
  label: string;
  tone: RelativeDateTone;
  /** Full date for the tooltip. */
  title: string;
  /** Set only for overdue open work (docs/51 D1 escalation). */
  level?: OverdueLevel;
}

/** docs/49 §5.1: the row's relative date label. */
export function relativeTaskDate(
  task: Pick<ManagerTask, 'scheduledOn' | 'dueAt' | 'status' | 'closedAt'> & Partial<Pick<ManagerTask, 'kind' | 'outcome' | 'startsAt'>>,
  today: string,
): RelativeTaskDate | null {
  if (!isOpenStatus(task.status) && task.closedAt) {
    const closed = localDateOf(task.closedAt)!;
    return { label: `Closed ${shortDay(closed, today)}`, tone: 'muted', title: `Closed ${format(parseISO(closed), 'EEE, MMM d, yyyy')}` };
  }
  const plan = taskPlanDate(task);
  if (!plan.date) return null;
  const title = `${plan.source === 'due' ? 'Due' : 'Scheduled'} ${format(parseISO(plan.date), 'EEE, MMM d, yyyy')}`;
  const diff = daysBetween(today, plan.date);
  // docs/56 UX-08: a meeting is never overdue. Once its day has passed it needs an outcome
  // (the Meetings lens's own rule), and with one recorded it is just a past day.
  if (task.kind === 'meeting' && diff < 0) {
    return meetingNeedsOutcome(task, today)
      ? { label: 'Needs outcome', tone: 'warning', title: `Meeting ${format(parseISO(plan.date), 'EEE, MMM d, yyyy')} · no outcome yet`, level: 1 }
      : { label: shortDay(plan.date, today), tone: 'muted', title };
  }
  if (diff < 0) {
    return { label: `${-diff}d overdue`, tone: overdueTone(plan.source), title, level: overdueLevel(-diff, plan.source) };
  }
  if (diff === 0) return { label: plan.source === 'due' ? 'Due today' : 'Today', tone: 'default', title };
  if (diff === 1) return { label: 'Tomorrow', tone: 'default', title };
  return { label: shortDay(plan.date, today), tone: 'muted', title };
}

/** docs/56 UX-08: an open meeting whose day has passed with no outcome recorded. */
export function meetingNeedsOutcome(
  task: Pick<ManagerTask, 'scheduledOn' | 'status'> & Partial<Pick<ManagerTask, 'kind' | 'outcome' | 'startsAt'>>,
  today: string,
): boolean {
  if (task.kind !== 'meeting' || !isOpenStatus(task.status) || task.outcome?.trim()) return false;
  const day = localDateOf(task.startsAt ?? null) ?? task.scheduledOn;
  return Boolean(day && day < today);
}

/** Short relative day name used in hints and toasts ("today", "Fri", "Oct 3"). */
export function shortDay(date: string, today: string): string {
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
  const showOwner = !(owner === 'me' || owner === 'inbox' || definition?.filters?.lane === 'inbox' || context.mode === 'owner');
  const singleDay = context.mode === 'scheduled' && (context.bucket === 'Today' || context.bucket === 'Tomorrow');
  const tone = relativeTaskDate(task, today)?.tone;
  const showDate = !(singleDay && tone !== 'danger' && tone !== 'warning' && isOpenStatus(task.status));
  return { showOwner, showDate };
}

/**
 * docs/51 D3: a group reserves the fixed date column only when at least one
 * of its rows shows a date — single-day buckets collapse it instead of
 * leaving signal icons orphaned in front of an empty column.
 */
export function groupShowsDate(
  definition: TaskViewDefinition | undefined,
  context: TaskGroupContext,
  tasks: Pick<ManagerTask, 'scheduledOn' | 'dueAt' | 'status' | 'closedAt'>[],
  today: string,
): boolean {
  return tasks.some((task) => impliedMeta(definition, context, task, today).showDate && relativeTaskDate(task, today) !== null);
}

/**
 * docs/51 D1: the loudest overdue tone among open rows — the group header
 * and the rail badge use it so they never out-shout the rows they summarize.
 */
export function worstOverdueTone(tasks: Pick<ManagerTask, 'scheduledOn' | 'dueAt' | 'status'>[], today: string): 'danger' | 'warning' | null {
  let worst: 'danger' | 'warning' | null = null;
  for (const task of tasks) {
    if (!isOpenStatus(task.status)) continue;
    const plan = taskPlanDate(task);
    if (!plan.date || plan.date >= today) continue;
    if (plan.source === 'due') return 'danger';
    worst = 'warning';
  }
  return worst;
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
  /** docs/51 F13: where the action sent the row, e.g. "moved → Tomorrow". */
  hint?: string | null;
}

export type ListTask = ManagerTask & { oneOnOne?: true; lingering?: boolean; lingerHint?: string | null };

export interface RenderGroup extends Omit<TaskViewGroupBucket, 'tasks'> {
  tasks: ListTask[];
  /** docs/51 F5: collapsible groups (Done today) render a chevron header. */
  collapsible?: boolean;
  collapsed?: boolean;
  /** Header count while collapsed (tasks stay hidden, so tasks.length lies). */
  count?: number;
}

/** Record where each acted-on row sits right now so it can stay put. */
export function lingerEntriesFor(
  groups: RenderGroup[],
  items: ManagerTask[],
  /** docs/51 F13: destination hint per task key ("moved → Tomorrow"). */
  hints?: ReadonlyMap<string, string | null>,
): Map<string, LingerEntry> {
  const entries = new Map<string, LingerEntry>();
  for (const task of items) {
    groups.forEach((group, groupIndex) => {
      const index = group.tasks.findIndex((row) => row.taskKey === task.taskKey);
      if (index >= 0 && !entries.has(task.taskKey)) {
        entries.set(task.taskKey, { task, groupKey: group.key, groupLabel: group.label, groupIndex, context: group.context, index, hint: hints?.get(task.taskKey) ?? null });
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
    const row: ListTask = current ? { ...current } : { ...entry.task, lingering: true, lingerHint: entry.hint ?? null };
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

/** docs/51 F8: next date with ISO weekday `dow` (1=Mon … 7=Sun), strictly after `today`. */
export function nextWeekday(today: string, dow: number): string {
  const ahead = ((dow % 7) - parseISO(today).getDay() + 7) % 7 || 7;
  return shiftLocalIsoDate(today, ahead);
}

/**
 * docs/51 F13: the destination a change sent a task to — rendered as the
 * lingering row's hint ("moved → Tomorrow", "done", "assigned → Me").
 */
export function lingerHint(
  changes: UpdateTaskRequest,
  today: string,
  ownerName: (ownerType: string | null, ownerId: string | null) => string,
): string | null {
  if (changes.status !== undefined) {
    const hints: Partial<Record<TaskStatus, string>> = { done: 'done', dropped: 'dropped', blocked: 'blocked', active: 'active', open: 'reopened' };
    return hints[changes.status] ?? changes.status;
  }
  if (changes.later === true) return 'moved → Later';
  if (changes.scheduledOn !== undefined) {
    if (!changes.scheduledOn) return 'date cleared';
    // Reuse the row's own relative-date wording so the hint matches the UI.
    const label = relativeTaskDate({ scheduledOn: changes.scheduledOn, dueAt: null, status: 'open', closedAt: null }, today)?.label;
    return `moved → ${label ?? shortDay(changes.scheduledOn, today)}`;
  }
  if (changes.ownerType !== undefined) return `assigned → ${ownerName(changes.ownerType ?? null, changes.ownerId ?? null)}`;
  return null;
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

/** docs/57 §1: a patch touching any of these fields is a triage decision (mirrors the server). */
const TRIAGE_FIELDS = ['scheduledOn', 'dueAt', 'ownerType', 'ownerId', 'later', 'hideUntil', 'status'] as const;

function isTriagePatch(changes: UpdateTaskRequest): boolean {
  return TRIAGE_FIELDS.some((field) => Object.hasOwn(changes, field));
}

/** Server-side side effects mirrored for optimistic patches. */
export function optimisticTask<T extends ManagerTask>(task: T, changes: UpdateTaskRequest, now = new Date().toISOString()): T {
  const { triaged, ...fields } = changes;
  const next: T = { ...task, ...(fields as Partial<ManagerTask>) };
  if (changes.later === true && changes.scheduledOn === undefined) next.scheduledOn = null;
  if (changes.later !== undefined && changes.hideUntil === undefined) next.hideUntil = null;
  if (triaged !== undefined) next.needsTriage = !triaged;
  else if (isTriagePatch(changes)) next.needsTriage = false;
  // docs/57 §2: the write shape has no `since`; keep the old one for the same party.
  if (changes.waitingOn !== undefined) {
    const input = changes.waitingOn;
    const same = input && task.waitingOn && input.type === task.waitingOn.type && (input.ref ?? null) === task.waitingOn.ref;
    next.waitingOn = input
      ? { type: input.type, ref: input.ref ?? null, label: input.label ?? task.waitingOn?.label ?? '', since: same ? task.waitingOn!.since : now }
      : null;
  }
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
  // docs/57 §1: any `later` patch clears the resurface date server-side, so
  // restoring a parked task restores its date too.
  if (undo.later === true && task.hideUntil) undo.hideUntil = task.hideUntil;
  // The DTO carries `since`; the write shape does not.
  if (fields.has('waitingOn')) {
    const previous = task.waitingOn;
    undo.waitingOn = previous ? { type: previous.type, ref: previous.ref, label: previous.label } : null;
  }
  // Triaging takes a task out of Inbox; undo puts it back.
  if (task.needsTriage && isTriagePatch(changes)) undo.triaged = false;
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
  if (filters.priority) defaults.priority = filters.priority;
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
    case 'meeting':
      // Today and Needs outcome are today's; Upcoming is tomorrow's; Recent has no day of its own.
      defaults.scheduledOn = context.bucket === 'Upcoming' ? shiftLocalIsoDate(today, 1) : today;
      break;
    case 'party':
      // docs/57 §4: a task added under a party waits on them (owned by me).
      if (context.waitingOn) defaults.waitingOn = context.waitingOn;
      else defaults.status = 'blocked';
      break;
    default:
      break;
  }
  // Later ⇒ no date; developer-owned tasks cannot be Later.
  if (defaults.later) delete defaults.scheduledOn;
  if (defaults.ownerType === 'developer') delete defaults.later;
  return defaults;
}

/**
 * docs/57 §3 (P3-05): the same context as `inlineAddDefaults`, in the shape
 * `POST /api/capture` takes. Inline add goes through the shared grammar, so a
 * title may carry tokens; these only fill what it leaves open. Status groups
 * other than open/active/blocked (done, dropped) add an ordinary open task,
 * and a manager-owned group adds a bare capture (mine, in Inbox until triaged).
 */
export function captureDefaultsFromTask(defaults: Partial<CreateTaskRequest>): CaptureDefaults {
  const out: CaptureDefaults = {};
  if (defaults.priority) out.priority = defaults.priority;
  if (defaults.later) out.later = true;
  if (defaults.ownerType === null) out.ownerAccountId = null;
  else if (defaults.ownerType === 'developer' && defaults.ownerId) out.ownerAccountId = defaults.ownerId;
  if (defaults.kind === 'meeting') out.kind = 'meeting';
  if (defaults.scheduledOn !== undefined) out.scheduledOn = defaults.scheduledOn;
  if (defaults.status === 'open' || defaults.status === 'active' || defaults.status === 'blocked') out.status = defaults.status;
  if (defaults.labels?.length) out.labels = defaults.labels;
  if (defaults.waitingOn) out.waitingOn = defaults.waitingOn;
  return out;
}

/** Inline add's context as capture defaults. */
export function inlineCaptureDefaults(
  viewId: string | undefined,
  definition: TaskViewDefinition | undefined,
  context: TaskGroupContext,
  today: string,
): CaptureDefaults {
  return captureDefaultsFromTask(inlineAddDefaults(viewId, definition, context, today));
}
