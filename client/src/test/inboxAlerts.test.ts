import { describe, expect, it } from 'vitest';
import { describeInboxAlert, describeInboxBatch, describeInboxChange, titleWithUnread } from '@/lib/inbox-alerts';
import type { TaskInboxItem } from '@/types';

const base: TaskInboxItem = {
  id: 1,
  eventId: 9,
  taskKey: 'T-7',
  title: 'Ship release',
  kind: 'instruction',
  actorName: 'Priya Rao',
  excerpt: 'Check the release key',
  occurredAt: '2026-10-12T09:00:00Z',
  readAt: null,
  href: '/t/T-7?event=9',
};
const with_ = (patch: Partial<TaskInboxItem>): TaskInboxItem => ({ ...base, ...patch });

describe('describeInboxAlert', () => {
  it('names who, what and which task for every kind', () => {
    expect(describeInboxAlert(with_({ kind: 'assignment' }))).toEqual({ title: 'Priya assigned T-7', body: 'Ship release' });
    expect(describeInboxAlert(base)).toEqual({ title: 'Priya sent an instruction', body: 'T-7 · Ship release\nCheck the release key' });
    expect(describeInboxAlert(with_({ kind: 'reply' })).title).toBe('Priya replied on T-7');
    expect(describeInboxAlert(with_({ kind: 'blocker' })).title).toBe('Priya flagged a blocker on T-7');
    expect(describeInboxAlert(with_({ kind: 'blocker_cleared' }))).toEqual({ title: 'Blocker cleared on T-7', body: 'Ship release' });
  });

  it('words due-date, plan-date and priority changes from the change facts', () => {
    const due = with_({ kind: 'schedule', change: { field: 'due_at', from: '2026-10-16', to: '2026-10-20' } });
    expect(describeInboxAlert(due)).toEqual({ title: 'Priya changed the due date on T-7', body: 'Ship release\nDue Tue 20 Oct (was Fri 16 Oct)' });
    const day = with_({ kind: 'schedule', change: { field: 'day', from: '2026-10-12', to: '2026-10-14' } });
    expect(describeInboxAlert(day)).toEqual({ title: 'Priya rescheduled T-7', body: 'Ship release\nMoved from Mon 12 Oct to Wed 14 Oct' });
    expect(describeInboxChange(with_({ change: { field: 'due_at', from: '2026-10-16', to: null } }))).toBe('Due date cleared');
    expect(describeInboxChange(with_({ change: { field: 'day', from: '2026-10-12', to: null } }))).toBe('Taken off the plan');
    const raised = with_({ kind: 'priority', change: { field: 'priority', from: 'normal', to: 'high' } });
    expect(describeInboxAlert(raised).title).toBe('Priya marked T-7 high priority');
    const lowered = with_({ kind: 'priority', change: { field: 'priority', from: 'high', to: 'normal' } });
    expect(describeInboxAlert(lowered).title).toBe('Priya lowered the priority of T-7');
    expect(describeInboxChange(base)).toBeUndefined();
  });

  it('keeps long excerpts short enough for a notification', () => {
    const { body } = describeInboxAlert(with_({ excerpt: 'x'.repeat(400) }));
    expect(body.split('\n')[1]).toHaveLength(140);
  });
});

describe('describeInboxBatch', () => {
  it('summarises several updates as one, listing the first three', () => {
    const items = [1, 2, 3, 4, 5].map((id) => with_({ id, taskKey: `T-${id}`, kind: id === 2 ? 'schedule' : 'reply' }));
    expect(describeInboxBatch(items)).toEqual({
      title: '5 new updates',
      body: 'T-1 · Reply\nT-2 · Date changed\nT-3 · Reply\n+2 more',
    });
  });
});

describe('titleWithUnread', () => {
  it('prefixes the count, replaces an old one and clears at zero', () => {
    expect(titleWithUnread('LeadOS', 3)).toBe('(3) LeadOS');
    expect(titleWithUnread('(3) LeadOS', 4)).toBe('(4) LeadOS');
    expect(titleWithUnread('(4) LeadOS', 0)).toBe('LeadOS');
    expect(titleWithUnread('LeadOS', 250)).toBe('(99+) LeadOS');
  });
});
