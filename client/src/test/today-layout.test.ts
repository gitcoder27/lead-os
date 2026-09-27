import { describe, expect, it } from 'vitest';
import {
  defaultFollowUpTitle,
  deltaChips,
  formatSince,
  headerMetrics,
  railItems,
  signalChips,
  splitPulse,
  todaySectionOrder,
  withoutWrapUpItems,
} from '@/lib/today-layout';
import { nextTodayProgress, EMPTY_TODAY_PROGRESS } from '@/lib/today-progress';
import type { TodayActionItem, TodayDelta, TodayFocus, TodayPromiseItem, TodayResponse, TodayTeamPulseItem } from '@/types';

const dev = (id: string) => ({ type: 'developer' as const, view: 'team' as const, developerAccountId: id });
const desk = (id: number) => ({ type: 'follow_up' as const, view: 'follow-ups' as const, managerDeskItemId: id });

function row(id: string, overrides: Partial<TodayActionItem> = {}): TodayActionItem {
  const target = overrides.target ?? desk(Number(id.replace(/\D/g, '')) || 1);
  return {
    id,
    type: 'follow_up_due',
    title: id,
    context: '',
    signal: '',
    severity: 'warning',
    priority: 50,
    group: 'now',
    target,
    primaryAction: { kind: 'mark_done', label: 'Done', target },
    secondaryActions: [],
    ...overrides,
  };
}

function person(id: string): TodayTeamPulseItem {
  return {
    accountId: id,
    displayName: `Person ${id}`,
    initials: 'P',
    status: 'On track',
    tone: 'neutral',
    detail: '',
    currentWork: '',
    lastUpdate: '',
    target: dev(id),
    primaryAction: { kind: 'open', label: 'Open', target: dev(id) },
    secondaryActions: [],
  };
}

function promise(id: number): TodayPromiseItem {
  return { id: `promise-${id}`, title: `P${id}`, detail: '', severity: 'warning', target: desk(id), primaryAction: { kind: 'mark_done', label: 'Done', target: desk(id) }, secondaryActions: [] };
}

describe('todaySectionOrder (docs/53 F6)', () => {
  it('orders blocks by stage around the queue', () => {
    expect(todaySectionOrder('morning_plan')).toEqual(['delta', 'standup', 'queue']);
    expect(todaySectionOrder('standup_window')).toEqual(['delta', 'standup', 'queue']);
    expect(todaySectionOrder('midday_check')).toEqual(['delta', 'queue', 'dueSoon', 'standup']);
    expect(todaySectionOrder('wrap_up')).toEqual(['wrapUp', 'delta', 'queue']);
    expect(todaySectionOrder(undefined)).toEqual(['delta', 'queue']);
  });
});

describe('one place per item (docs/53 U1)', () => {
  it('moves people already in the queue to the avatar strip', () => {
    const queue = [row('dev-row', { type: 'stale_check_in', target: dev('a') }), row('set-current', { type: 'developer_attention', target: { ...dev('b'), type: 'tracker_item', trackerItemId: 9, taskKey: 'T-9' } })];
    const { rows, queued } = splitPulse([person('a'), person('b'), person('c')], queue);
    expect(rows.map((entry) => entry.accountId)).toEqual(['c']);
    expect(queued.map((entry) => entry.accountId)).toEqual(['a', 'b']);
  });

  it('keeps only promises and meetings the queue does not show', () => {
    const items = railItems([promise(1), promise(2)], [], [row('x1', { target: desk(1) })]);
    expect(items.map((entry) => entry.item.id)).toEqual(['promise-2']);
  });

  it('hands wrap-up-owned promises and carry rows to the EOD block', () => {
    const focus: TodayFocus = {
      stage: 'wrap_up',
      wrapUp: {
        missingCheckIns: [],
        openPromises: [promise(1)],
        carryCandidates: [row('carry-3', { type: 'desk_carry_forward', target: { ...desk(3), type: 'manager_desk_item' } })],
        eodNoteTarget: { type: 'view', view: 'notes' },
      },
    };
    const queue = [
      row('f1', { target: desk(1) }),
      row('c3', { type: 'desk_carry_forward', target: { ...desk(3), type: 'manager_desk_item' } }),
      row('f2', { target: desk(2) }),
      row('issue', { type: 'overdue_issue', target: { type: 'issue', view: 'work', issueKey: 'AM-1' } }),
    ];
    expect(withoutWrapUpItems(queue, focus).map((item) => item.id)).toEqual(['f2', 'issue']);
    expect(withoutWrapUpItems(queue, undefined)).toBe(queue);
  });
});

describe('row and header copy', () => {
  it('shows up to two reason chips (docs/53 U5)', () => {
    expect(signalChips('Overdue / Unassigned / High priority')).toEqual(['Overdue', 'Unassigned']);
    expect(signalChips('Stale without current work')).toEqual(['Stale', 'No current work']);
    expect(signalChips('')).toEqual([]);
  });

  it('keeps four decision metrics plus a broken sync (docs/53 U3)', () => {
    const summary = ['attention', 'work', 'team', 'stale', 'due-work', 'promises', 'sync'].map((id) => ({ id, label: id, value: 1, detail: '', severity: 'warning' as const }));
    expect(headerMetrics(summary).map((metric) => metric.id)).toEqual(['attention', 'stale', 'due-work', 'promises', 'sync']);
  });

  it('builds follow-up titles from the person and issue (docs/53 F16)', () => {
    const snapshot = { teamPulse: [{ ...person('d1'), displayName: 'Deepak Rao' }], actionItems: [] } as unknown as TodayResponse;
    expect(defaultFollowUpTitle(snapshot, { ...dev('d1'), context: { issueKey: 'AM-123' } })).toBe('Follow up with Deepak on AM-123');
    expect(defaultFollowUpTitle(snapshot, dev('d1'))).toBe('Follow up with Deepak');
    expect(defaultFollowUpTitle(snapshot, { type: 'issue', view: 'work', issueKey: 'AM-9' })).toBe('Follow up on AM-9');
  });
});

describe('since-last-visit strip', () => {
  const base: TodayDelta = {
    since: '2026-03-07T13:10:00.000Z',
    newIssues: { count: 2, items: [{ jiraKey: 'AM-1', summary: '', target: { type: 'issue', view: 'work', issueKey: 'AM-1' } }, { jiraKey: 'AM-2', summary: '', target: { type: 'issue', view: 'work', issueKey: 'AM-2' } }] },
    overdueOvernight: { count: 1, items: [{ jiraKey: 'AM-3', summary: '', target: { type: 'issue', view: 'work', issueKey: 'AM-3', filter: 'overdue' } }] },
    newCheckIns: { count: 3, people: [{ developerAccountId: 'd1', displayName: 'Deepak', count: 3, latestAt: '', target: dev('d1') }] },
    followUpsNewlyDue: { count: 0, items: [] },
    resolvedCount: 4,
  };

  it('orders chips by urgency and deep-links single items directly', () => {
    const chips = deltaChips(base, '2026-03-08');
    expect(chips.map((chip) => chip.label)).toEqual(['1 went overdue', '2 new defects', '3 check-ins', '4 resolved']);
    expect(chips[0]?.target).toMatchObject({ issueKey: 'AM-3' });
    expect(chips[1]?.target).toMatchObject({ view: 'work' });
    expect(chips[1]?.detail).toBe('AM-1, AM-2');
    expect(chips[2]?.target).toMatchObject({ developerAccountId: 'd1' });
    expect(chips[3]?.target).toBeUndefined();
  });

  it('is empty without a baseline', () => {
    expect(deltaChips({ ...base, since: undefined }, '2026-03-08')).toEqual([]);
  });

  it('formats the baseline relative to now', () => {
    const now = new Date(2026, 2, 8, 9, 0);
    expect(formatSince(new Date(2026, 2, 8, 7, 5).toISOString(), now)).toBe('07:05');
    expect(formatSince(new Date(2026, 2, 7, 18, 40).toISOString(), now)).toBe('yesterday 18:40');
    expect(formatSince(new Date(2026, 2, 5, 18, 40).toISOString(), now)).toBe('Thu 18:40');
  });
});

describe('session progress (docs/53 U2)', () => {
  it('counts rows that left the queue and un-counts ones that return', () => {
    let state = nextTodayProgress(EMPTY_TODAY_PROGRESS, ['a', 'b', 'c']);
    expect(state.cleared).toEqual([]);
    state = nextTodayProgress(state, ['b', 'c', 'd']);
    expect(state.cleared).toEqual(['a']);
    state = nextTodayProgress(state, ['a', 'd']);
    expect(state.cleared.sort()).toEqual(['b', 'c']);
  });
});
