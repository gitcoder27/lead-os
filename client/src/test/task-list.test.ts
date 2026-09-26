import { describe, expect, it } from 'vitest';
import type { ManagerTask } from '@/types';
import {
  applyLingering,
  impliedMeta,
  inlineAddDefaults,
  lingerEntriesFor,
  nextMonday,
  optimisticTask,
  relativeTaskDate,
  scheduleChanges,
  searchTasks,
  taskPlanDate,
  toggledDoneStatus,
  undoChanges,
  type RenderGroup,
} from '@/lib/task-list';
import {
  RETIRED_TASK_VIEWS,
  applyTaskViewOverrides,
  groupTaskViewTasks,
  hasTaskViewOverrides,
  scheduledBucket,
  taskViewParamsFromState,
  taskViewStateFromParams,
} from '@/lib/task-views';

const TODAY = '2026-09-26'; // Saturday

function task(overrides: Partial<ManagerTask> = {}): ManagerTask {
  return {
    id: 1, taskKey: 'T-1', title: 'Task', kind: 'task', status: 'open', ownerType: 'manager', ownerId: 'm',
    priority: 'normal', scheduledOn: null, dueAt: null, startsAt: null, endsAt: null, participants: null, outcome: null,
    createdByType: 'manager', createdById: 'm', createdAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-24T10:00:00Z',
    closedAt: null, deletedAt: null, links: [], later: false, parentId: null, trackedByManagerId: 'm', labels: [],
    nextAction: null, followUpAt: null,
    ...overrides,
  } as ManagerTask;
}

const ownerName = (type: string | null, id: string | null) => (type === 'developer' ? `Dev ${id}` : type ? 'Me' : 'Inbox');

describe('plan date + relative dates (docs/49 D1, §5.1)', () => {
  it('plan date is the earlier of scheduledOn and the dueAt date', () => {
    expect(taskPlanDate(task({ scheduledOn: '2026-09-30' }))).toEqual({ date: '2026-09-30', source: 'scheduled' });
    expect(taskPlanDate(task({ scheduledOn: '2026-09-30', dueAt: '2026-09-27' }))).toEqual({ date: '2026-09-27', source: 'due' });
    expect(taskPlanDate(task({}))).toEqual({ date: null, source: null });
  });

  it('labels overdue, today, tomorrow, weekdays, and far dates', () => {
    expect(relativeTaskDate(task({ scheduledOn: '2026-09-23' }), TODAY)).toMatchObject({ label: '3d overdue', tone: 'warning' });
    expect(relativeTaskDate(task({ dueAt: '2026-09-25' }), TODAY)).toMatchObject({ label: '1d overdue', tone: 'danger' });
    expect(relativeTaskDate(task({ scheduledOn: TODAY }), TODAY)).toMatchObject({ label: 'Today', tone: 'default' });
    expect(relativeTaskDate(task({ dueAt: TODAY }), TODAY)).toMatchObject({ label: 'Due today' });
    expect(relativeTaskDate(task({ scheduledOn: '2026-09-27' }), TODAY)).toMatchObject({ label: 'Tomorrow' });
    expect(relativeTaskDate(task({ scheduledOn: '2026-10-01' }), TODAY)).toMatchObject({ label: 'Thu', tone: 'muted' });
    expect(relativeTaskDate(task({ scheduledOn: '2026-11-12' }), TODAY)).toMatchObject({ label: 'Nov 12' });
    expect(relativeTaskDate(task({ scheduledOn: '2027-01-03' }), TODAY)).toMatchObject({ label: 'Jan 3, 2027' });
    expect(relativeTaskDate(task({}), TODAY)).toBeNull();
    expect(relativeTaskDate(task({ status: 'done', closedAt: '2026-09-24' }), TODAY)).toMatchObject({ label: 'Closed Thu' });
  });
});

describe('scheduled grouping (docs/49 §3)', () => {
  it('buckets by plan date in fixed order', () => {
    const rows = [
      task({ taskKey: 'T-1', scheduledOn: '2026-10-20' }),
      task({ taskKey: 'T-2' }),
      task({ taskKey: 'T-3', scheduledOn: '2026-09-20' }),
      task({ taskKey: 'T-4', scheduledOn: TODAY }),
      task({ taskKey: 'T-5', scheduledOn: '2026-09-27' }),
      task({ taskKey: 'T-6', scheduledOn: '2026-10-03' }),
      task({ taskKey: 'T-7', scheduledOn: '2026-10-10', dueAt: '2026-09-25' }),
    ];
    const groups = groupTaskViewTasks(rows, 'scheduled', TODAY, ownerName);
    expect(groups.map((group) => [group.label, group.tasks.map((row) => row.taskKey)])).toEqual([
      ['Overdue', ['T-3', 'T-7']],
      ['Today', ['T-4']],
      ['Tomorrow', ['T-5']],
      ['Next 7 days', ['T-6']],
      ['Beyond', ['T-1']],
      ['Unscheduled', ['T-2']],
    ]);
    expect(scheduledBucket(task({ scheduledOn: '2026-10-04' }), TODAY)).toBe('Beyond');
  });

  it('orders owner groups Me → developers → Inbox with owner context', () => {
    const groups = groupTaskViewTasks([
      task({ taskKey: 'T-1', ownerType: null, ownerId: null }),
      task({ taskKey: 'T-2', ownerType: 'developer', ownerId: 'b' }),
      task({ taskKey: 'T-3' }),
      task({ taskKey: 'T-4', ownerType: 'developer', ownerId: 'a' }),
    ], 'owner', TODAY, ownerName);
    expect(groups.map((group) => group.label)).toEqual(['Me', 'Dev a', 'Dev b', 'Inbox']);
    expect(groups[1]!.context).toEqual({ mode: 'owner', ownerType: 'developer', ownerId: 'a' });
  });

  it('ungrouped returns a single unlabeled bucket', () => {
    expect(groupTaskViewTasks([task()], undefined, TODAY, ownerName)).toEqual([{ key: 'all', label: '', tasks: [task()], context: { mode: 'none' } }]);
  });
});

describe('URL contract (docs/49 §9, D6)', () => {
  it('round-trips existing and new params', () => {
    const params = new URLSearchParams('view=my-tasks&owner=dev-1,dev-2&status=open,blocked&label=x&group=none&sort=updated&kind=meeting&q=review');
    const state = taskViewStateFromParams(params);
    expect(state).toEqual({
      view: 'my-tasks',
      overrides: { owner: 'dev-1,dev-2', status: ['open', 'blocked'], label: ['x'], group: 'none', sort: 'updated', kind: 'meeting' },
      q: 'review',
    });
    expect(taskViewParamsFromState(state).toString()).toBe(params.toString());
  });

  it('drops invalid values', () => {
    expect(taskViewStateFromParams(new URLSearchParams('status=nope&group=x&sort=y&kind=z&signal=late')).overrides).toEqual({});
  });

  it('resolves retired view ids with their implied overrides; explicit params win', () => {
    for (const [id, target] of Object.entries(RETIRED_TASK_VIEWS)) {
      expect(taskViewStateFromParams(new URLSearchParams(`view=${id}`))).toEqual({ view: target.view, overrides: target.overrides });
    }
    expect(taskViewStateFromParams(new URLSearchParams('view=blocked&status=open')).overrides).toEqual({ status: ['open'] });
    expect(taskViewStateFromParams(new URLSearchParams('view=jira-drift'))).toEqual({ view: 'attention', overrides: { signal: ['drift'] } });
  });

  it('applies overrides onto a definition', () => {
    const base = { filters: { owner: 'me' as const, later: false }, sort: 'scheduled' as const, group: 'scheduled' as const };
    expect(applyTaskViewOverrides(base, { owner: 'dev-1,dev-2', group: 'none', kind: 'meeting' })).toEqual({
      filters: { owner: ['dev-1', 'dev-2'], later: false, kind: 'meeting' }, sort: 'scheduled',
    });
    expect(applyTaskViewOverrides({ filters: { attention: ['overdue', 'stale', 'drift'] } }, { signal: ['stale'] }).filters).toEqual({ attention: ['stale'] });
    expect(applyTaskViewOverrides(base, { owner: 'team' }).filters?.owner).toBe('team');
    expect(hasTaskViewOverrides({})).toBe(false);
    expect(hasTaskViewOverrides({ status: [] })).toBe(false);
    expect(hasTaskViewOverrides({ kind: 'task' })).toBe(true);
  });
});

describe('implied meta (docs/49 §5.2)', () => {
  it('hides owner in "me"/inbox views and owner groups', () => {
    expect(impliedMeta({ filters: { owner: 'me' } }, { mode: 'none' }, task(), TODAY).showOwner).toBe(false);
    expect(impliedMeta({ filters: { owner: 'inbox' } }, { mode: 'none' }, task(), TODAY).showOwner).toBe(false);
    expect(impliedMeta({ filters: {} }, { mode: 'owner', ownerType: 'manager', ownerId: 'm' }, task(), TODAY).showOwner).toBe(false);
    expect(impliedMeta({ filters: { owner: 'team' } }, { mode: 'none' }, task(), TODAY).showOwner).toBe(true);
  });

  it('hides the date inside single-day buckets unless overdue', () => {
    expect(impliedMeta(undefined, { mode: 'scheduled', bucket: 'Today' }, task({ scheduledOn: TODAY }), TODAY).showDate).toBe(false);
    expect(impliedMeta(undefined, { mode: 'scheduled', bucket: 'Tomorrow' }, task({ scheduledOn: '2026-09-27' }), TODAY).showDate).toBe(false);
    expect(impliedMeta(undefined, { mode: 'scheduled', bucket: 'Next 7 days' }, task({ scheduledOn: '2026-10-01' }), TODAY).showDate).toBe(true);
    expect(impliedMeta(undefined, { mode: 'none' }, task({ scheduledOn: TODAY }), TODAY).showDate).toBe(true);
  });
});

describe('lingering rows (docs/49 §8.1)', () => {
  const groups = (): RenderGroup[] => [
    { key: 'Overdue', label: 'Overdue', context: { mode: 'scheduled', bucket: 'Overdue' }, tasks: [task({ taskKey: 'T-1' }), task({ taskKey: 'T-2' })] },
    { key: 'Today', label: 'Today', context: { mode: 'scheduled', bucket: 'Today' }, tasks: [task({ taskKey: 'T-3' }), task({ taskKey: 'T-4' })] },
  ];

  it('R1: a row that left the list stays in its original group and index, flagged lingering', () => {
    const entries = lingerEntriesFor(groups(), [task({ taskKey: 'T-3', status: 'done' })]);
    const fresh: RenderGroup[] = [groups()[0]!, { ...groups()[1]!, tasks: [task({ taskKey: 'T-4' })] }];
    const merged = applyLingering(fresh, entries);
    expect(merged[1]!.tasks.map((row) => [row.taskKey, row.lingering ?? false, row.status])).toEqual([['T-3', true, 'done'], ['T-4', false, 'open']]);
  });

  it('R1: a row that moved buckets is pinned in place using the fresh copy', () => {
    const entries = lingerEntriesFor(groups(), [task({ taskKey: 'T-1', scheduledOn: TODAY })]);
    const fresh: RenderGroup[] = [
      { ...groups()[0]!, tasks: [task({ taskKey: 'T-2' })] },
      { ...groups()[1]!, tasks: [task({ taskKey: 'T-1', scheduledOn: TODAY, title: 'fresh' }), task({ taskKey: 'T-3' }), task({ taskKey: 'T-4' })] },
    ];
    const merged = applyLingering(fresh, entries);
    expect(merged[0]!.tasks.map((row) => row.taskKey)).toEqual(['T-1', 'T-2']);
    expect(merged[0]!.tasks[0]).toMatchObject({ title: 'fresh' });
    expect(merged[1]!.tasks.map((row) => row.taskKey)).toEqual(['T-3', 'T-4']);
  });

  it('recreates a vanished group at its original position', () => {
    const entries = lingerEntriesFor(groups(), [task({ taskKey: 'T-1', status: 'done' }), task({ taskKey: 'T-2', status: 'done' })]);
    const merged = applyLingering([groups()[1]!], entries);
    expect(merged.map((group) => group.key)).toEqual(['Overdue', 'Today']);
    expect(merged[0]!.tasks.map((row) => row.taskKey)).toEqual(['T-1', 'T-2']);
  });

  it('R4: no entries → groups untouched', () => {
    const input = groups();
    expect(applyLingering(input, new Map())).toBe(input);
  });
});

describe('actions and undo (docs/49 §6)', () => {
  it('toggles done and computes schedule presets', () => {
    expect(toggledDoneStatus('open')).toBe('done');
    expect(toggledDoneStatus('blocked')).toBe('done');
    expect(toggledDoneStatus('done')).toBe('open');
    expect(toggledDoneStatus('dropped')).toBe('open');
    expect(nextMonday(TODAY)).toBe('2026-09-28');
    expect(nextMonday('2026-09-28')).toBe('2026-10-05');
    expect(scheduleChanges('today', TODAY)).toEqual({ scheduledOn: TODAY, later: false });
    expect(scheduleChanges('tomorrow', TODAY)).toEqual({ scheduledOn: '2026-09-27', later: false });
    expect(scheduleChanges('next-week', TODAY)).toEqual({ scheduledOn: '2026-09-28', later: false });
    expect(scheduleChanges('later', TODAY)).toEqual({ later: true });
    expect(scheduleChanges('clear', TODAY)).toEqual({ scheduledOn: null, later: false });
  });

  it('mirrors server side effects optimistically', () => {
    expect(optimisticTask(task({ scheduledOn: TODAY }), { later: true })).toMatchObject({ later: true, scheduledOn: null });
    expect(optimisticTask(task(), { status: 'done' }, 'now').closedAt).toBe('now');
    expect(optimisticTask(task({ status: 'done', closedAt: 'x' }), { status: 'open' }).closedAt).toBeNull();
    expect(optimisticTask(task({ status: 'active' }), { ownerType: 'developer', ownerId: 'd' }).status).toBe('open');
  });

  it('undo restores touched fields and their server side effects', () => {
    expect(undoChanges(task({ status: 'open' }), { status: 'done' })).toEqual({ status: 'open' });
    expect(undoChanges(task({ scheduledOn: '2026-09-20' }), { later: true })).toEqual({ later: false, scheduledOn: '2026-09-20' });
    expect(undoChanges(task({ later: true }), { scheduledOn: TODAY, later: false })).toEqual({ later: true, scheduledOn: null });
    expect(undoChanges(task({ status: 'active' }), { ownerType: 'developer', ownerId: 'd' })).toEqual({ ownerType: 'manager', ownerId: 'm', status: 'active' });
    expect(undoChanges(task({ labels: ['a'] }), { labels: ['a', 'b'] })).toEqual({ labels: ['a'] });
  });
});

describe('inline add context (docs/49 §6.1)', () => {
  it('inherits schedule, owner, status, label, and view context', () => {
    expect(inlineAddDefaults('today', { filters: { horizon: 'today' } }, { mode: 'scheduled', bucket: 'Today' }, TODAY)).toEqual({ scheduledOn: TODAY });
    expect(inlineAddDefaults('my-tasks', {}, { mode: 'scheduled', bucket: 'Tomorrow' }, TODAY)).toEqual({ scheduledOn: '2026-09-27' });
    expect(inlineAddDefaults('my-tasks', {}, { mode: 'scheduled', bucket: 'Next 7 days' }, TODAY)).toEqual({ scheduledOn: '2026-09-28' });
    expect(inlineAddDefaults('my-tasks', {}, { mode: 'scheduled', bucket: 'Beyond' }, TODAY)).toEqual({ scheduledOn: '2026-10-04' });
    expect(inlineAddDefaults('my-tasks', {}, { mode: 'scheduled', bucket: 'Unscheduled' }, TODAY)).toEqual({ scheduledOn: null });
    expect(inlineAddDefaults('waiting', {}, { mode: 'owner', ownerType: 'developer', ownerId: 'd' }, TODAY)).toEqual({ ownerType: 'developer', ownerId: 'd' });
    expect(inlineAddDefaults('waiting', {}, { mode: 'owner', ownerType: 'manager', ownerId: 'm' }, TODAY)).toEqual({ ownerType: 'manager' });
    expect(inlineAddDefaults('waiting', {}, { mode: 'owner', ownerType: null, ownerId: null }, TODAY)).toEqual({ ownerType: null, ownerId: null });
    expect(inlineAddDefaults('x', {}, { mode: 'status', status: 'blocked' }, TODAY)).toEqual({ status: 'blocked' });
    expect(inlineAddDefaults('x', {}, { mode: 'label', label: 'hiring' }, TODAY)).toEqual({ labels: ['hiring'] });
    expect(inlineAddDefaults('later', { filters: { later: true } }, { mode: 'none' }, TODAY)).toEqual({ later: true });
    expect(inlineAddDefaults('inbox', { filters: { owner: 'inbox' } }, { mode: 'none' }, TODAY)).toEqual({ ownerType: null, ownerId: null });
    expect(inlineAddDefaults('my-tasks', { filters: { kind: 'meeting' } }, { mode: 'none' }, TODAY)).toEqual({ kind: 'meeting' });
    expect(inlineAddDefaults('upcoming', { filters: { horizon: 'upcoming' } }, { mode: 'none' }, TODAY)).toEqual({ scheduledOn: '2026-09-27' });
  });
});

describe('search (docs/49 D7)', () => {
  it('matches title, key, next action, labels, and Jira refs', () => {
    const rows = [
      task({ taskKey: 'T-1', title: 'Hiring loop' }),
      task({ taskKey: 'T-2', nextAction: 'waiting on Priya' }),
      task({ taskKey: 'T-3', labels: ['escalation'] }),
      task({ taskKey: 'T-4', links: [{ id: 1, kind: 'jira', ref: 'APP-9', role: 'primary' }] }),
    ];
    expect(searchTasks(rows, 'hiring').map((row) => row.taskKey)).toEqual(['T-1']);
    expect(searchTasks(rows, 'PRIYA').map((row) => row.taskKey)).toEqual(['T-2']);
    expect(searchTasks(rows, 'escal').map((row) => row.taskKey)).toEqual(['T-3']);
    expect(searchTasks(rows, 'app-9').map((row) => row.taskKey)).toEqual(['T-4']);
    expect(searchTasks(rows, 't-2').map((row) => row.taskKey)).toEqual(['T-2']);
    expect(searchTasks(rows, '  ')).toBe(rows);
  });
});
