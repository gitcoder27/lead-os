import { describe, expect, it } from 'vitest';
import { buildActivityFeed, describeChange, messageBody, summarizeChanges, viaLabel } from '@/lib/task-activity';
import type { TaskEvent } from '@/types';

let nextId = 100;
const at = (minutesAgo: number) => new Date(Date.UTC(2026, 9, 11, 12, 0) - minutesAgo * 60_000).toISOString();
function event(type: TaskEvent['type'], meta: Record<string, unknown> | null, overrides: Partial<TaskEvent> = {}): TaskEvent {
  nextId -= 1;
  return { id: nextId, taskKey: 'T-1', type, body: null, visibility: 'shared', author: { type: 'system', id: 'dev-1' }, meta, occurredAt: at(0), approximateTime: false, ...overrides };
}

describe('activity changes in plain words (docs/56 MDA-02)', () => {
  it('says what happened instead of raw status transitions', () => {
    const status = (from: string | null, to: string, reason?: string) => describeChange(event('status', { domain: 'task_status', from, to, reason }));
    expect(status('open', 'active', 'user')).toBe('Started working on it');
    expect(status('active', 'open', 'single_current')).toBe('Paused for another task');
    expect(status('active', 'open', 'user')).toBe('Moved back to the queue');
    expect(status('in_progress', 'planned', 'reassigned')).toBe('Back to planned after reassignment');
    expect(status('done', 'open')).toBe('Reopened');
    expect(status('open', 'done')).toBe('Marked done');
    expect(status('planned', 'backlog')).toBe('Moved to Later');
    expect(status('open', 'blocked')).toBe('Marked blocked');
    expect(status('blocked', 'open')).toBe('Unblocked');
  });

  it('reads schedules, links and focus with friendly dates', () => {
    expect(describeChange(event('schedule', { field: 'day', from: '2026-10-10', to: '2026-10-11', via: 'carry_forward' }))).toBe('Carried over to Sun 11 Oct');
    expect(describeChange(event('schedule', { field: 'day', from: '2026-10-10', to: '2026-10-13', via: 'reschedule' }))).toBe('Moved to Tue 13 Oct');
    expect(describeChange(event('schedule', { field: 'follow_up_at', from: null, to: null, via: 'edit' }))).toBe('Follow-up cleared');
    expect(describeChange(event('link', { action: 'removed', kind: 'jira', ref: 'APP-2' }))).toBe('Unlinked APP-2');
    expect(describeChange(event('link', { action: 'added', kind: 'person', ref: 'dev-2' }), (id) => (id === 'dev-2' ? 'Tom' : undefined))).toBe('Linked Tom');
    expect(describeChange(event('focus', { action: 'set_current', date: '2026-10-11' }))).toBe('Started working on it');
    expect(describeChange(event('focus', { action: 'unset_current', date: '2026-09-28' }))).toBe('Stopped working on it for Mon 28 Sep');
  });

  it('labels where a message came from only when it adds something', () => {
    expect(viaLabel(event('update', { via: 'standup' }))).toBe('in standup');
    expect(viaLabel(event('update', { via: 'task_drawer' }))).toBeUndefined();
    expect(messageBody(event('checkin_ref', { date: '2026-10-10', developerAccountId: 'dev-1', excerpt: 'Ready' }))).toBe('Ready');
  });
});

describe('change runs (docs/56 MDA-02)', () => {
  it('pairs a focus toggle with the status change it caused', () => {
    const run = [
      event('status', { domain: 'task_status', from: 'active', to: 'open', reason: 'single_current' }, { occurredAt: at(10) }),
      event('focus', { action: 'unset_current', date: '2026-10-11' }, { occurredAt: at(10) }),
      event('status', { domain: 'task_status', from: 'open', to: 'active', reason: 'user' }, { occurredAt: at(60) }),
      event('focus', { action: 'set_current', date: '2026-10-11' }, { occurredAt: at(60) }),
    ];
    expect(summarizeChanges(run).map((change) => change.text)).toEqual(['Paused for another task', 'Started working on it']);
  });

  it('merges daily carry-overs and mirrored duplicates, and counts real repeats', () => {
    const carry = (to: string, minutesAgo: number) => event('schedule', { field: 'day', from: null, to, via: 'carry_forward' }, { occurredAt: at(minutesAgo) });
    const carried = summarizeChanges([carry('2026-10-11', 0), carry('2026-10-10', 1440), carry('2026-10-09', 2880)]);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ count: 3, text: 'Carried over 3 times, now Sun 11 Oct' });

    const done = (minutesAgo: number, domain: string) => event('status', { domain, from: 'open', to: 'done' }, { occurredAt: at(minutesAgo) });
    expect(summarizeChanges([done(0, 'task_status'), done(0, 'tracker_state')])[0]).toMatchObject({ count: 1, text: 'Marked done' });
    expect(summarizeChanges([done(0, 'task_status'), done(600, 'task_status')])[0]).toMatchObject({ count: 2 });
  });

  it('tells a day of switching tasks as one change', () => {
    const status = (from: string, to: string, minutesAgo: number) => event('status', { domain: 'task_status', from, to, reason: to === 'open' ? 'single_current' : 'user' }, { occurredAt: at(minutesAgo) });
    const loop = [status('open', 'active', 0), status('active', 'open', 20), status('open', 'active', 40), status('active', 'open', 60), status('open', 'active', 80)];
    expect(summarizeChanges(loop).map((change) => change.text)).toEqual(['Paused and resumed twice']);
    expect(summarizeChanges(loop.slice(1)).map((change) => change.text)).toEqual(['Started and paused twice']);
    expect(summarizeChanges(loop.slice(0, 2)).map((change) => change.text)).toEqual(['Started working on it', 'Paused for another task']);
  });

  it('folds renames into first and last title', () => {
    const changes = summarizeChanges([
      event('title', { from: 'B', to: 'C' }, { occurredAt: at(0) }),
      event('title', { from: 'A', to: 'B' }, { occurredAt: at(30) }),
    ]);
    expect(changes.map((change) => change.text)).toEqual(['Renamed from “A” to “C”']);
  });

  it('keeps messages whole, groups the changes between them, and ends on creation', () => {
    const feed = buildActivityFeed([
      event('update', null, { body: 'Shipped the draft', author: { type: 'developer', id: 'dev-1' } }),
      event('status', { domain: 'task_status', from: 'open', to: 'active' }),
      event('schedule', { field: 'day', from: '2026-10-09', to: '2026-10-10', via: 'reschedule' }),
      event('update', null, { body: 'Kick-off notes', author: { type: 'manager', id: 'maya' } }),
      event('created', { source: 'capture', ownerType: 'developer', ownerId: 'dev-1', title: 'Ledger job' }),
    ]);
    expect(feed.map((item) => item.kind === 'message' ? `msg:${item.event.body}` : item.changes.map((change) => change.text).join(' | '))).toEqual([
      'msg:Shipped the draft',
      'Started working on it | Moved to Sat 10 Oct',
      'msg:Kick-off notes',
      'Created for dev-1',
    ]);
  });
});
