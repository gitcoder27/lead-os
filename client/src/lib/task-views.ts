import type {
  ManagerTask,
  TaskAttentionSignal,
  TaskStatus,
  TaskViewDefinition,
  TaskViewGroup,
  TaskViewSort,
} from '@/types';
import { shiftLocalIsoDate } from '@/lib/utils';
import { taskPlanDate } from '@/lib/task-list';

/**
 * Phase 3 (P3-D9/D10, spec §5.2; docs/49 §3/§9): client-side helpers for task
 * view definitions — URL serialization for `/tasks?view=<id>` plus filter
 * overrides, retired-view aliases, and the base64url `viewDef` wire format
 * for `GET /api/tasks`.
 */

export const DEFAULT_TASK_VIEW_ID = 'today';

/** Browser-side mirror of the server's base64url JSON encoder. */
export function encodeTaskViewDefinition(definition: TaskViewDefinition): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(definition))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export type TaskViewGroupOverride = TaskViewGroup | 'none';

/** Transient overrides expressed as flat URL params alongside `?view=`. */
export interface TaskViewOverrides {
  /** `me` | `team` | `inbox`, or a comma list of developer account ids. */
  owner?: string;
  status?: TaskStatus[];
  label?: string[];
  group?: TaskViewGroupOverride;
  sort?: TaskViewSort;
  kind?: 'task' | 'meeting';
  signal?: TaskAttentionSignal[];
}

const TASK_STATUSES: readonly TaskStatus[] = ['open', 'active', 'blocked', 'done', 'dropped'];
const TASK_VIEW_GROUPS: readonly TaskViewGroupOverride[] = ['owner', 'status', 'label', 'scheduled', 'none'];
const TASK_VIEW_SORTS: readonly TaskViewSort[] = ['scheduled', 'updated', 'created', 'priority'];
const TASK_SIGNALS: readonly TaskAttentionSignal[] = ['overdue', 'stale', 'drift'];
export const OWNER_TOKENS = ['me', 'team', 'inbox'] as const;

export interface TaskViewUrlState {
  view?: string;
  overrides: TaskViewOverrides;
  /** docs/49 D7: transient text search, never saved into a view. */
  q?: string;
}

/**
 * docs/49 D6: retired built-in ids resolve to their nearest current view plus
 * overrides, so old `?view=` links keep working.
 */
export const RETIRED_TASK_VIEWS: Record<string, { view: string; overrides: TaskViewOverrides }> = {
  'today-plan': { view: 'today', overrides: {} },
  watching: { view: 'waiting', overrides: { owner: 'team' } },
  blocked: { view: 'waiting', overrides: { status: ['blocked'] } },
  'follow-ups': { view: 'waiting', overrides: {} },
  meetings: { view: 'my-tasks', overrides: { kind: 'meeting' } },
  stale: { view: 'attention', overrides: { signal: ['stale'] } },
  'jira-drift': { view: 'attention', overrides: { signal: ['drift'] } },
};

export function taskViewStateFromParams(params: URLSearchParams): TaskViewUrlState {
  const csv = (key: string) => (params.get(key) ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const owner = csv('owner').join(',');
  const status = csv('status').filter((v): v is TaskStatus => (TASK_STATUSES as readonly string[]).includes(v));
  const label = csv('label');
  const signal = csv('signal').filter((v): v is TaskAttentionSignal => (TASK_SIGNALS as readonly string[]).includes(v));
  const groupParam = params.get('group');
  const sortParam = params.get('sort');
  const kindParam = params.get('kind');
  const q = params.get('q')?.trim();
  const overrides: TaskViewOverrides = {
    ...(owner ? { owner } : {}),
    ...(status.length ? { status } : {}),
    ...(label.length ? { label } : {}),
    ...(groupParam && (TASK_VIEW_GROUPS as readonly string[]).includes(groupParam) ? { group: groupParam as TaskViewGroupOverride } : {}),
    ...(sortParam && (TASK_VIEW_SORTS as readonly string[]).includes(sortParam) ? { sort: sortParam as TaskViewSort } : {}),
    ...(kindParam === 'task' || kindParam === 'meeting' ? { kind: kindParam } : {}),
    ...(signal.length ? { signal } : {}),
  };
  const view = params.get('view')?.trim() || undefined;
  const retired = view ? RETIRED_TASK_VIEWS[view] : undefined;
  return {
    view: retired ? retired.view : view,
    // Explicit URL params win over the alias's implied overrides.
    overrides: retired ? { ...retired.overrides, ...overrides } : overrides,
    ...(q ? { q } : {}),
  };
}

/** Compose the effective definition: base view + URL overrides. */
export function applyTaskViewOverrides(base: TaskViewDefinition, overrides: TaskViewOverrides): TaskViewDefinition {
  const filters = { ...(base.filters ?? {}) };
  if (overrides.owner) {
    filters.owner = (OWNER_TOKENS as readonly string[]).includes(overrides.owner)
      ? (overrides.owner as 'me' | 'team' | 'inbox')
      : overrides.owner.split(',').filter(Boolean);
  }
  if (overrides.status) filters.status = overrides.status;
  if (overrides.label) filters.labels = overrides.label;
  if (overrides.kind) filters.kind = overrides.kind;
  if (overrides.signal?.length) filters.attention = overrides.signal;
  const group = overrides.group === 'none' ? undefined : overrides.group ?? base.group;
  return {
    filters,
    ...(overrides.sort ?? base.sort ? { sort: overrides.sort ?? base.sort } : {}),
    ...(group ? { group } : {}),
  };
}

export function taskViewParamsFromState(state: TaskViewUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.view) params.set('view', state.view);
  const { owner, status, label, group, sort, kind, signal } = state.overrides;
  if (owner) params.set('owner', owner);
  if (status?.length) params.set('status', status.join(','));
  if (label?.length) params.set('label', label.join(','));
  if (group) params.set('group', group);
  if (sort) params.set('sort', sort);
  if (kind) params.set('kind', kind);
  if (signal?.length) params.set('signal', signal.join(','));
  if (state.q) params.set('q', state.q);
  return params;
}

/** True when any override is set (drives dirty-dot / Revert / Reset). */
export function hasTaskViewOverrides(overrides: TaskViewOverrides): boolean {
  return Object.values(overrides).some((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value)));
}

export type TaskGroupContext =
  | { mode: 'none' }
  | { mode: 'scheduled'; bucket: ScheduledBucket }
  | { mode: 'owner'; ownerType: 'manager' | 'developer' | null; ownerId: string | null }
  | { mode: 'status'; status: TaskStatus }
  | { mode: 'label'; label: string | null };

export interface TaskViewGroupBucket {
  key: string;
  label: string;
  tasks: ManagerTask[];
  context: TaskGroupContext;
}

const STATUS_GROUP_ORDER: TaskStatus[] = ['open', 'active', 'blocked', 'done', 'dropped'];
const STATUS_GROUP_LABELS: Record<TaskStatus, string> = {
  open: 'Open', active: 'Active', blocked: 'Blocked', done: 'Done', dropped: 'Dropped',
};

export type ScheduledBucket = 'Overdue' | 'Today' | 'Tomorrow' | 'Next 7 days' | 'Beyond' | 'Unscheduled';
export const SCHEDULED_GROUP_ORDER: ScheduledBucket[] = ['Overdue', 'Today', 'Tomorrow', 'Next 7 days', 'Beyond', 'Unscheduled'];

/** docs/49 §3: bucket by plan date (earlier of scheduledOn and the dueAt date). */
export function scheduledBucket(task: Pick<ManagerTask, 'scheduledOn' | 'dueAt'>, today: string): ScheduledBucket {
  const plan = taskPlanDate(task).date;
  if (!plan) return 'Unscheduled';
  if (plan < today) return 'Overdue';
  if (plan === today) return 'Today';
  if (plan === shiftLocalIsoDate(today, 1)) return 'Tomorrow';
  if (plan <= shiftLocalIsoDate(today, 7)) return 'Next 7 days';
  return 'Beyond';
}

/** Group task rows for the current `group` mode. Ungrouped → a single bucket. */
export function groupTaskViewTasks(
  tasks: ManagerTask[],
  group: TaskViewGroup | undefined,
  today: string,
  ownerName: (ownerType: string | null, ownerId: string | null) => string,
): TaskViewGroupBucket[] {
  if (!group) return [{ key: 'all', label: '', tasks, context: { mode: 'none' } }];
  const buckets = new Map<string, { tasks: ManagerTask[]; context: TaskGroupContext; label: string }>();
  const push = (key: string, label: string, context: TaskGroupContext, task: ManagerTask) => {
    const bucket = buckets.get(key) ?? { tasks: [], context, label };
    bucket.tasks.push(task);
    buckets.set(key, bucket);
  };
  for (const task of tasks) {
    switch (group) {
      case 'owner': {
        const key = task.ownerType ? `${task.ownerType}:${task.ownerId}` : 'inbox';
        push(key, task.ownerType ? ownerName(task.ownerType, task.ownerId) : 'Inbox', { mode: 'owner', ownerType: task.ownerType, ownerId: task.ownerId }, task);
        break;
      }
      case 'status':
        push(task.status, STATUS_GROUP_LABELS[task.status] ?? task.status, { mode: 'status', status: task.status }, task);
        break;
      case 'label':
        if (task.labels.length) for (const label of task.labels) push(`label:${label}`, label, { mode: 'label', label }, task);
        else push('label:', 'No labels', { mode: 'label', label: null }, task);
        break;
      case 'scheduled': {
        const bucket = scheduledBucket(task, today);
        push(bucket, bucket, { mode: 'scheduled', bucket }, task);
        break;
      }
    }
  }
  const keys = [...buckets.keys()];
  const ownerRank = (key: string) => (key.startsWith('manager:') ? 0 : key === 'inbox' ? 2 : 1);
  if (group === 'status') keys.sort((a, b) => STATUS_GROUP_ORDER.indexOf(a as TaskStatus) - STATUS_GROUP_ORDER.indexOf(b as TaskStatus));
  else if (group === 'scheduled') keys.sort((a, b) => SCHEDULED_GROUP_ORDER.indexOf(a as ScheduledBucket) - SCHEDULED_GROUP_ORDER.indexOf(b as ScheduledBucket));
  else if (group === 'owner') keys.sort((a, b) => ownerRank(a) - ownerRank(b) || buckets.get(a)!.label.localeCompare(buckets.get(b)!.label));
  else keys.sort((a, b) => (a === 'label:' ? 1 : b === 'label:' ? -1 : a.localeCompare(b)));
  return keys.map((key) => {
    const bucket = buckets.get(key)!;
    return { key, label: bucket.label, tasks: bucket.tasks, context: bucket.context };
  });
}
