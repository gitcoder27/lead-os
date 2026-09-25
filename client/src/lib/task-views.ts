import type { ManagerTask, TaskStatus, TaskViewDefinition, TaskViewGroup, TaskViewSort } from '@/types';

/**
 * Phase 3 (P3-D9/D10, spec §5.2): client-side helpers for task view
 * definitions — URL serialization for `/tasks?view=<id>` plus filter
 * overrides, and the base64url `viewDef` wire format for `GET /api/tasks`.
 */

/** Browser-side mirror of the server's base64url JSON encoder. */
export function encodeTaskViewDefinition(definition: TaskViewDefinition): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(definition))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Transient overrides expressed as flat URL params alongside `?view=`. */
export interface TaskViewOverrides {
  owner?: string;
  status?: TaskStatus[];
  label?: string[];
  group?: TaskViewGroup;
  sort?: TaskViewSort;
}

const TASK_STATUSES: readonly TaskStatus[] = ['open', 'active', 'blocked', 'done', 'dropped'];
const TASK_VIEW_GROUPS: readonly TaskViewGroup[] = ['owner', 'status', 'label', 'scheduled'];
const TASK_VIEW_SORTS: readonly TaskViewSort[] = ['scheduled', 'updated', 'created', 'priority'];

export interface TaskViewUrlState {
  view?: string;
  overrides: TaskViewOverrides;
}

export function taskViewStateFromParams(params: URLSearchParams): TaskViewUrlState {
  const csv = (key: string) => (params.get(key) ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const owner = params.get('owner')?.trim();
  const status = csv('status').filter((v): v is TaskStatus => (TASK_STATUSES as readonly string[]).includes(v));
  const label = csv('label');
  const groupParam = params.get('group');
  const sortParam = params.get('sort');
  const overrides: TaskViewOverrides = {
    ...(owner ? { owner } : {}),
    ...(status.length ? { status } : {}),
    ...(label.length ? { label } : {}),
    ...(groupParam && (TASK_VIEW_GROUPS as readonly string[]).includes(groupParam) ? { group: groupParam as TaskViewGroup } : {}),
    ...(sortParam && (TASK_VIEW_SORTS as readonly string[]).includes(sortParam) ? { sort: sortParam as TaskViewSort } : {}),
  };
  return { view: params.get('view')?.trim() || undefined, overrides };
}

/** Compose the effective definition: base view + URL overrides. */
export function applyTaskViewOverrides(base: TaskViewDefinition, overrides: TaskViewOverrides): TaskViewDefinition {
  const filters = { ...(base.filters ?? {}) };
  if (overrides.owner) filters.owner = overrides.owner === 'me' || overrides.owner === 'team' || overrides.owner === 'inbox' ? overrides.owner : [overrides.owner];
  if (overrides.status) filters.status = overrides.status;
  if (overrides.label) filters.labels = overrides.label;
  return {
    filters,
    sort: overrides.sort ?? base.sort,
    group: overrides.group ?? base.group,
  };
}

export function taskViewParamsFromState(state: TaskViewUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.view) params.set('view', state.view);
  const { owner, status, label, group, sort } = state.overrides;
  if (owner) params.set('owner', owner);
  if (status?.length) params.set('status', status.join(','));
  if (label?.length) params.set('label', label.join(','));
  if (group) params.set('group', group);
  if (sort) params.set('sort', sort);
  return params;
}

export interface TaskViewGroupBucket {
  key: string;
  label: string;
  tasks: ManagerTask[];
}

const STATUS_GROUP_ORDER: TaskStatus[] = ['open', 'active', 'blocked', 'done', 'dropped'];
const STATUS_GROUP_LABELS: Record<TaskStatus, string> = {
  open: 'Open', active: 'Active', blocked: 'Blocked', done: 'Done', dropped: 'Dropped',
};

function scheduledBucket(task: ManagerTask, today: string): string {
  const scheduled = task.scheduledOn;
  if (!scheduled) return 'Unscheduled';
  if (scheduled < today) return 'Overdue';
  if (scheduled === today) return 'Today';
  return 'Upcoming';
}

const SCHEDULED_GROUP_ORDER = ['Overdue', 'Today', 'Upcoming', 'Unscheduled'];

/** Group task rows for the current `group` mode. Ungrouped → a single bucket. */
export function groupTaskViewTasks(
  tasks: ManagerTask[],
  group: TaskViewGroup | undefined,
  today: string,
  ownerName: (ownerType: string | null, ownerId: string | null) => string,
): TaskViewGroupBucket[] {
  if (!group) return [{ key: 'all', label: '', tasks }];
  const buckets = new Map<string, ManagerTask[]>();
  const push = (key: string, task: ManagerTask) => {
    const list = buckets.get(key) ?? [];
    list.push(task);
    buckets.set(key, list);
  };
  for (const task of tasks) {
    switch (group) {
      case 'owner':
        push(task.ownerType ? ownerName(task.ownerType, task.ownerId) : 'Inbox', task);
        break;
      case 'status':
        push(task.status, task);
        break;
      case 'label':
        if (task.labels.length) for (const label of task.labels) push(label, task);
        else push('No labels', task);
        break;
      case 'scheduled':
        push(scheduledBucket(task, today), task);
        break;
    }
  }
  const keys = [...buckets.keys()];
  if (group === 'status') keys.sort((a, b) => STATUS_GROUP_ORDER.indexOf(a as TaskStatus) - STATUS_GROUP_ORDER.indexOf(b as TaskStatus));
  else if (group === 'scheduled') keys.sort((a, b) => SCHEDULED_GROUP_ORDER.indexOf(a) - SCHEDULED_GROUP_ORDER.indexOf(b));
  else keys.sort((a, b) => a.localeCompare(b));
  return keys.map((key) => ({
    key,
    label: group === 'status' ? STATUS_GROUP_LABELS[key as TaskStatus] ?? key : key,
    tasks: buckets.get(key)!,
  }));
}
