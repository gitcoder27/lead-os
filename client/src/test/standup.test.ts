import { beforeEach, describe, expect, it } from 'vitest';
import type { ManagerSurfaceTask, StandupFeedEntry, TrackerDeveloperDay } from '@/types';
import {
  EMPTY_STANDUP_SESSION,
  buildStandupSummary,
  dayStats,
  describeFeedEntry,
  doneTodayFor,
  feedActiveTaskKeys,
  feedCounts,
  followUpReasons,
  groupStandupFeed,
  loadStandupSession,
  needsFollowUp,
  openTasksFor,
  saveStandupSession,
  sessionTotals,
  standupSessionReducer,
  type StandupSession,
} from '@/lib/standup';

function task(overrides: Partial<ManagerSurfaceTask>): ManagerSurfaceTask {
  return {
    id: 1, taskKey: 'T-1', title: 'Task', kind: 'task', status: 'open', ownerType: 'developer', ownerId: 'dev-1',
    priority: 'normal', scheduledOn: '2026-03-07', dueAt: null, startsAt: null, endsAt: null, participants: null,
    outcome: null, createdByType: 'manager', createdById: 'manager-1', createdAt: '2026-03-07T08:00:00Z',
    updatedAt: '2026-03-07T08:00:00Z', closedAt: null, deletedAt: null, links: [], later: false,
    trackedByManagerId: null, parentId: null, labels: [], nextAction: null, followUpAt: null, position: 0,
    originDate: '2026-03-07', itemType: 'custom', lifecycle: 'tracker_only', relatedIssueKeys: [],
    ...overrides,
  };
}

function day(overrides: Partial<TrackerDeveloperDay> = {}): TrackerDeveloperDay {
  return {
    id: 1, date: '2026-03-07',
    developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
    availability: { state: 'active' }, status: 'on_track',
    plannedItems: [], completedItems: [], droppedItems: [], checkIns: [], recentCheckIns: [], isStale: false,
    signals: {
      freshness: { staleThresholdHours: 4, noCurrentThresholdHours: 2, statusFollowUpThresholdHours: 2, staleByTime: false, staleWithOpenRisk: false, staleWithoutCurrentWork: false, statusChangeWithoutFollowUp: false },
      risk: { openRisk: false, overdueLinkedWork: false, overdueLinkedCount: 0 },
    },
    createdAt: '2026-03-07T08:00:00Z', updatedAt: '2026-03-07T08:00:00Z',
    ...overrides,
  };
}

function event(id: number, overrides: Partial<StandupFeedEntry>): StandupFeedEntry {
  return { id: `event:${id}`, kind: 'event', occurredAt: `2026-03-07T0${id}:00:00Z`, taskKey: 'T-1', taskTitle: 'Ship', type: 'update', ...overrides };
}

describe('standup tasks & day stats', () => {
  const alice = day({
    tasks: [
      task({ id: 3, taskKey: 'T-3', status: 'blocked', position: 2 }),
      task({ id: 1, taskKey: 'T-1', status: 'active', position: 0, priority: 'high' }),
      task({ id: 2, taskKey: 'T-2', status: 'open', position: 1 }),
      task({ id: 4, taskKey: 'T-4', status: 'done', position: 3, title: 'Closed today' }),
      task({ id: 5, taskKey: 'T-5', status: 'dropped', position: 4 }),
    ],
    checkIns: [{ id: 1, dayId: 1, summary: 'hi', createdAt: '2026-03-07T09:00:00Z', taskKeys: [] }],
    lastCheckInAt: '2026-03-07T09:00:00Z',
  });

  it('orders open work by position and excludes closed tasks', () => {
    expect(openTasksFor(alice).map((entry) => entry.taskKey)).toEqual(['T-1', 'T-2', 'T-3']);
    expect(openTasksFor(alice)[0]).toMatchObject({ status: 'active', highPriority: true });
    expect(doneTodayFor(alice)).toEqual([{ taskKey: 'T-4', title: 'Closed today' }]);
  });

  it('falls back to legacy tracker items when tasks are absent', () => {
    const legacy = day({
      currentItem: { id: 1, dayId: 1, originDate: '2026-03-07', taskKey: 'T-9', lifecycle: 'tracker_only', itemType: 'custom', title: 'Legacy', state: 'in_progress', position: 0, createdAt: '', updatedAt: '' },
      plannedItems: [{ id: 2, dayId: 1, originDate: '2026-03-07', taskKey: null, lifecycle: 'tracker_only', itemType: 'custom', title: 'No key', state: 'planned', position: 1, createdAt: '', updatedAt: '' }],
    });
    expect(openTasksFor(legacy)).toEqual([expect.objectContaining({ taskKey: 'T-9', status: 'active' })]);
  });

  it('summarises the day strip', () => {
    expect(dayStats(alice, '2026-03-07')).toMatchObject({
      current: expect.objectContaining({ taskKey: 'T-1' }),
      open: 3,
      blocked: 1,
      doneToday: 1,
      checkInsToday: 1,
    });
    expect(dayStats(day(), '2026-03-07')).toMatchObject({ current: undefined, open: 0, checkInsToday: 0 });
  });
});

describe('standup session', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('reviews once, toggles flags, and logging marks the person reviewed', () => {
    let state = standupSessionReducer(EMPTY_STANDUP_SESSION, { type: 'review', accountId: 'dev-1', at: 't1' });
    expect(state.startedAt).toBe('t1');
    expect(standupSessionReducer(state, { type: 'review', accountId: 'dev-1', at: 't2' })).toBe(state);
    state = standupSessionReducer(state, { type: 'toggle_flag', accountId: 'dev-2', at: 't3' });
    expect(state.flagged).toEqual(['dev-2']);
    state = standupSessionReducer(state, { type: 'toggle_flag', accountId: 'dev-2', at: 't4' });
    expect(state.flagged).toEqual([]);
    expect(state.startedAt).toBe('t1');
    state = standupSessionReducer(state, { type: 'log', entry: { accountId: 'dev-3', kind: 'checkin', at: 'now' } });
    expect(state.reviewed).toEqual(['dev-1', 'dev-3']);
    expect(state.log).toHaveLength(1);
    expect(standupSessionReducer(state, { type: 'reset' })).toEqual(EMPTY_STANDUP_SESSION);
  });

  it('round-trips through sessionStorage and tolerates corrupt data', () => {
    const session: StandupSession = { reviewed: ['dev-1'], flagged: ['dev-2'], log: [{ accountId: 'dev-1', kind: 'done', taskKey: 'T-1', at: 'x' }] };
    saveStandupSession('k', session);
    expect(loadStandupSession('k')).toEqual(session);
    saveStandupSession('k', EMPTY_STANDUP_SESSION);
    expect(window.sessionStorage.getItem('k')).toBeNull();
    window.sessionStorage.setItem('k', '{not json');
    expect(loadStandupSession('k')).toEqual(EMPTY_STANDUP_SESSION);
    window.sessionStorage.setItem('k', JSON.stringify({ reviewed: [1, 2], flagged: 'x', log: [null, { accountId: 'a', kind: 'update' }] }));
    expect(loadStandupSession('k')).toEqual({ reviewed: [], flagged: [], log: [{ accountId: 'a', kind: 'update' }] });
  });

  it('totals the session log', () => {
    const at = 'now';
    const totals = sessionTotals({
      reviewed: [], flagged: [],
      log: [
        { accountId: 'a', kind: 'update', at }, { accountId: 'a', kind: 'update', at }, { accountId: 'a', kind: 'done', at },
        { accountId: 'b', kind: 'blocked', at }, { accountId: 'b', kind: 'status', at }, { accountId: 'b', kind: 'checkin', at },
      ],
    });
    expect(totals).toMatchObject({ updates: 2, closed: 1, statusChanges: 2, checkins: 1 });
  });
});

describe('standup feed', () => {
  const entries: StandupFeedEntry[] = [
    event(9, { taskKey: 'T-1', type: 'update', body: 'latest on T-1' }),
    event(8, { id: 'checkin:1', kind: 'checkin', taskKey: undefined, type: undefined, summary: 'morning' }),
    event(7, { taskKey: 'T-2', taskTitle: 'Other', type: 'status', statusFrom: 'active', statusTo: 'open', statusReason: 'single_current' }),
    event(6, { taskKey: 'T-3', taskTitle: 'Stuck', type: 'blocker', blockerAction: 'raised', body: 'waiting on DBA' }),
    event(5, { taskKey: 'T-1', type: 'status', statusFrom: 'open', statusTo: 'done', statusReason: 'user' }),
  ];

  it('groups by task, drops single-current noise, and floats blockers first', () => {
    const groups = groupStandupFeed(entries);
    expect(groups.map((group) => group.id)).toEqual(['task:T-3', 'task:T-1', 'checkins']);
    expect(groups[1]!.entries.map((entry) => entry.id)).toEqual(['event:9', 'event:5']);
    expect(groups[1]!.importance).toBe(2);
    expect(groups[2]!.title).toBe('Check-ins');
  });

  it('counts and highlights meaningful activity only', () => {
    expect(feedCounts(entries)).toEqual({ updates: 1, blockers: 1, statusChanges: 1, checkins: 1 });
    expect([...feedActiveTaskKeys(entries)].sort()).toEqual(['T-1', 'T-3']);
  });

  it('describes entries with transitions and tones', () => {
    expect(describeFeedEntry(entries[4]!)).toEqual({ label: 'Open → Done', text: null, tone: 'success' });
    expect(describeFeedEntry(entries[3]!)).toEqual({ label: 'Blocker raised', text: 'waiting on DBA', tone: 'danger' });
    expect(describeFeedEntry(event(1, { type: 'blocker', blockerAction: 'cleared', body: null }))).toMatchObject({ label: 'Blocker cleared', tone: 'success' });
    expect(describeFeedEntry(event(1, { type: 'status' }))).toMatchObject({ label: 'Status changed' });
    expect(describeFeedEntry(entries[1]!)).toEqual({ label: 'Check-in', text: 'morning', tone: 'info' });
  });
});

describe('follow-ups & summary', () => {
  it('derives follow-up reasons; no check-in alone is not a follow-up', () => {
    const quiet = day();
    expect(followUpReasons(quiet, '2026-03-07', false).map((reason) => reason.code)).toEqual(['no_checkin']);
    expect(needsFollowUp(followUpReasons(quiet, '2026-03-07', false))).toBe(false);

    const busy = day({
      status: 'blocked',
      statusSuggestion: { status: 'blocked', reasonTaskKey: 'T-2' },
      oneOnOne: { seriesId: 1, scheduledFor: '2026-03-04', overdueDays: 3 },
      checkIns: [{ id: 1, dayId: 1, summary: 'x', createdAt: '2026-03-07T09:00:00Z', taskKeys: [] }],
    });
    const reasons = followUpReasons(busy, '2026-03-07', true);
    expect(reasons.map((reason) => reason.label)).toEqual(['Flagged', 'Blocked', 'T-2 blocked', '1:1 overdue 3d']);
    expect(needsFollowUp(reasons)).toBe(true);
    expect(followUpReasons(day({ status: 'done_for_today' }), '2026-03-07', false)).toEqual([]);
  });

  it('builds a plain-text summary of coverage, follow-ups, and actions', () => {
    const alice = day();
    const bob = day({ id: 2, developer: { accountId: 'dev-2', displayName: 'Bob Jones', isActive: true }, status: 'at_risk' });
    const text = buildStandupSummary({
      date: '2026-03-07',
      days: [alice, bob],
      session: {
        reviewed: ['dev-1'],
        flagged: ['dev-1'],
        log: [{ accountId: 'dev-1', kind: 'update', taskKey: 'T-1', at: 'x' }, { accountId: 'dev-1', kind: 'reassign', taskKey: 'T-2', detail: 'Bob Jones', at: 'y' }],
      },
    });
    expect(text).toContain('Standup 2026-03-07 — 1/2 reviewed');
    expect(text).toContain('- Alice Smith: Flagged, No check-in today');
    expect(text).toContain('- Bob Jones: At risk, No check-in today');
    expect(text).toContain('Not reviewed: Bob Jones');
    expect(text).toContain('- Alice Smith: Logged update on T-1; Reassigned T-2 to Bob Jones');
  });
});
