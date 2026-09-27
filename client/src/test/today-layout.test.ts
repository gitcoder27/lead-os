import { describe, expect, it } from 'vitest';
import {
  defaultFollowUpTitle,
  deltaChips,
  formatSince,
  headerMetrics,
  railItems,
  signalChips,
  splitPulse,
  todayPanelOrder,
  groupQueueItems,
  rowContext,
  splitPanelRows,
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

describe('todayPanelOrder (docs/53 F6)', () => {
  it('fills the stage panel by stage; the queue always owns the left column', () => {
    expect(todayPanelOrder('morning_plan')).toEqual(['standup', 'delta', 'oneOnOnes', 'carry', 'promises', 'people']);
    expect(todayPanelOrder('standup_window')).toEqual(['standup', 'delta', 'oneOnOnes', 'carry', 'promises', 'people']);
    expect(todayPanelOrder('midday_check')).toEqual(['dueSoon', 'quiet', 'delta', 'standup', 'oneOnOnes', 'carry', 'promises', 'people']);
    expect(todayPanelOrder('wrap_up')).toEqual(['wrapUp', 'delta', 'oneOnOnes', 'promises', 'people']);
    expect(todayPanelOrder(undefined)).toEqual(['delta', 'oneOnOnes', 'carry', 'promises', 'people']);
  });
});

describe('groupQueueItems', () => {
  const stale = (id: string, name: string, asked?: string) => row(id, {
    type: 'stale_check_in',
    title: name,
    signal: 'Stale by time',
    target: dev(id),
    primaryAction: { kind: 'add_check_in', label: 'Add check-in', target: dev(id) },
    secondaryActions: [{ kind: 'ask_check_in', label: 'Ask for update', target: dev(id) }],
    askedAt: asked,
  });

  it('folds three or more same-reason people rows into one row at the first member\'s position', () => {
    const items = [row('f1'), stale('a', 'Ayan Saha'), stale('b', 'Deepak Rao'), row('f2'), stale('c', 'Rohit', '2026-03-08T10:00:00Z')];
    const { items: out, groups } = groupQueueItems(items);
    expect(out.map((item) => item.id)).toEqual(['f1', 'group:people|stale_check_in|Stale by time|add_check_in', 'f2']);
    const group = [...groups.values()][0]!;
    expect(out[1]).toMatchObject({ title: '3 people', context: 'Ayan, Deepak, Rohit', signal: 'Stale by time', freshness: '1 asked' });
    expect(out[1]?.primaryAction).toMatchObject({ kind: 'ask_check_in', label: 'Ask 2' });
    expect(group.bulk?.commands.map((command) => command.target.developerAccountId)).toEqual(['a', 'b']);
  });

  it('leaves fewer than three alone', () => {
    const items = [stale('a', 'A'), stale('b', 'B')];
    expect(groupQueueItems(items).items).toBe(items);
  });
});

describe('rowContext', () => {
  it('drops server filler and says where old desk items came from', () => {
    expect(rowContext({ context: 'Open Manager Desk item', type: 'desk_carry_forward', target: { type: 'manager_desk_item', view: 'desk', date: '2026-03-05' } }, '2026-03-08')).toBe('from Thu 5 Mar');
    expect(rowContext({ context: 'Manager follow-up', type: 'follow_up_due', target: desk(1) }, '2026-03-08')).toBeUndefined();
    expect(rowContext({ context: 'AM-4', type: 'follow_up_due', target: desk(1) }, '2026-03-08')).toBe('AM-4');
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

describe('splitPanelRows', () => {
  it('hands standup, 1:1 and carry rows to the panel and keeps the rest in order', () => {
    const items = [
      row('f1'),
      row('s', { type: 'standup', target: { type: 'view', view: 'team', mode: 'standup' } }),
      row('o', { type: 'one_on_one', target: dev('x') }),
      row('c', { type: 'desk_carry_forward', target: { ...desk(9), type: 'manager_desk_item' } }),
      row('i', { type: 'overdue_issue', target: { type: 'issue', view: 'work', issueKey: 'AM-1' } }),
    ];
    const split = splitPanelRows(items);
    expect(split.queue.map((item) => item.id)).toEqual(['f1', 'i']);
    expect(split.standup?.id).toBe('s');
    expect(split.oneOnOnes.map((item) => item.id)).toEqual(['o']);
    expect(split.carry.map((item) => item.id)).toEqual(['c']);
  });

  it('folds identical follow-ups (two or more) with a Done-all bulk', () => {
    const items = [row('p1', { title: 'Ping QA' }), row('p2', { title: 'ping qa ' }), row('p3', { title: 'Other' })];
    const { items: out, groups } = groupQueueItems(items);
    expect(out).toHaveLength(2);
    const group = [...groups.values()][0]!;
    expect(group).toMatchObject({ kind: 'duplicates', reason: '×2' });
    expect(group.bulk?.label).toBe('Done all');
    expect(out[0]?.primaryAction.label).toBe('Done all');
  });
});
