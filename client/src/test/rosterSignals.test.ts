import { describe, expect, it } from 'vitest';
import type { TrackerAttentionItem, TrackerAttentionReason, TrackerDeveloperDay, TrackerWorkItem } from '@/types';
import { getRosterAttention, getRosterCheckIn, getRosterLoad } from '@/components/team-tracker/rosterSignals';

const NOW = new Date('2026-03-07T12:00:00.000Z');

function buildSignals(overrides?: {
  freshness?: Partial<TrackerDeveloperDay['signals']['freshness']>;
  risk?: Partial<TrackerDeveloperDay['signals']['risk']>;
}): TrackerDeveloperDay['signals'] {
  return {
    freshness: {
      staleThresholdHours: 4,
      noCurrentThresholdHours: 2,
      statusFollowUpThresholdHours: 2,
      staleByTime: false,
      staleWithOpenRisk: false,
      staleWithoutCurrentWork: false,
      statusChangeWithoutFollowUp: false,
      ...overrides?.freshness,
    },
    risk: { openRisk: false, overdueLinkedWork: false, overdueLinkedCount: 0, ...overrides?.risk },
  };
}

function item(id: number, title: string): TrackerWorkItem {
  return {
    id,
    dayId: 1,
    originDate: '2026-03-07',
    taskKey: `T-${id}`,
    lifecycle: 'tracker_only',
    itemType: 'custom',
    title,
    state: id === 1 ? 'in_progress' : 'planned',
    position: id,
    createdAt: '2026-03-07T08:00:00Z',
    updatedAt: '2026-03-07T08:00:00Z',
  };
}

function day(overrides: Partial<TrackerDeveloperDay> = {}): TrackerDeveloperDay {
  return {
    id: 1,
    date: '2026-03-07',
    developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
    availability: { state: 'active' },
    status: 'on_track',
    plannedItems: [],
    completedItems: [],
    droppedItems: [],
    checkIns: [],
    recentCheckIns: [],
    isStale: false,
    signals: buildSignals(),
    createdAt: '2026-03-07T08:00:00Z',
    updatedAt: '2026-03-07T08:00:00Z',
    ...overrides,
  };
}

function attention(target: TrackerDeveloperDay, reasons: Array<[TrackerAttentionReason['code'], string]>): TrackerAttentionItem {
  return {
    developer: target.developer,
    status: target.status,
    reasons: reasons.map(([code, label], index) => ({ code, label, priority: index + 1 })),
    isStale: target.isStale,
    signals: target.signals,
    hasCurrentItem: Boolean(target.currentItem),
    plannedCount: target.plannedItems.length,
    availableQuickActions: [],
    setCurrentCandidates: [],
  };
}

describe('getRosterAttention', () => {
  it('drops reasons another cell already states and keeps the row quiet', () => {
    const target = day({ signals: buildSignals({ freshness: { staleByTime: true } }) });
    const result = getRosterAttention(target, attention(target, [['stale_by_time', 'Stale by time'], ['no_current', 'No current item']]), NOW);

    expect(result.flags).toEqual([]);
    expect(result.rail).toBeNull();
    expect(result.summary).toBe('Stale by time · No current item');
  });

  it('keeps blocked in the status mark but still rails the row as danger', () => {
    const target = day({ status: 'blocked', signals: buildSignals({ risk: { overdueLinkedWork: true, overdueLinkedCount: 2 } }) });
    const result = getRosterAttention(
      target,
      attention(target, [['blocked', 'Blocked'], ['stale_with_open_risk', 'Stale with risk'], ['overdue_linked_work', 'Overdue linked work']]),
      NOW,
    );

    expect(result.rail).toBe('danger');
    expect(result.flags.map((flag) => flag.label)).toEqual(['2 overdue Jira', 'Stale with risk']);
  });

  it('rails at-risk rows as warning even though the reason itself is shown by the status', () => {
    const target = day({ status: 'at_risk' });
    const result = getRosterAttention(target, attention(target, [['at_risk', 'At Risk']]), NOW);

    expect(result.flags).toEqual([]);
    expect(result.rail).toBe('warning');
  });

  it('surfaces a due manager follow-up and a 1:1 as "needs me" flags', () => {
    const target = day({
      nextFollowUpAt: '2026-03-07T09:00:00Z',
      oneOnOne: { seriesId: 1, scheduledFor: '2026-03-05', overdueDays: 2 },
    });
    const result = getRosterAttention(target, undefined, NOW);

    expect(result.flags.map((flag) => flag.label)).toEqual(['Follow-up due', '1:1 overdue 2d']);
    expect(result.rail).toBe('warning');
  });

  it('does not flag a follow-up that is still in the future', () => {
    const target = day({ nextFollowUpAt: '2026-03-08T09:00:00Z', oneOnOne: { seriesId: 1, scheduledFor: '2026-03-07', overdueDays: 0 } });
    const result = getRosterAttention(target, undefined, NOW);

    expect(result.flags).toEqual([{ key: 'one-on-one', label: '1:1 today', tone: 'accent' }]);
    expect(result.rail).toBeNull();
  });

  it('falls back to client signals when the board did not rank the developer', () => {
    const target = day({
      status: 'blocked',
      signals: buildSignals({ freshness: { staleByTime: true, statusChangeWithoutFollowUp: true }, risk: { overdueLinkedWork: true, overdueLinkedCount: 1 } }),
    });
    const result = getRosterAttention(target, undefined, NOW);

    expect(result.rail).toBe('danger');
    expect(result.flags.map((flag) => flag.label)).toEqual(['Overdue Jira', 'Needs follow-up']);
  });
});

describe('getRosterCheckIn', () => {
  it('treats a missing check-in as stale', () => {
    expect(getRosterCheckIn(day(), NOW.getTime())).toMatchObject({ label: 'No check-in', stale: true });
  });

  it('uses compact relative time and the stale-by-time signal', () => {
    const fresh = getRosterCheckIn(day({ lastCheckInAt: '2026-03-07T10:00:00Z' }), NOW.getTime());
    expect(fresh).toEqual({ label: '2h ago', stale: false, title: undefined });

    const stale = getRosterCheckIn(
      day({ lastCheckInAt: '2026-03-07T06:00:00Z', signals: buildSignals({ freshness: { staleByTime: true } }) }),
      NOW.getTime(),
    );
    expect(stale).toEqual({ label: '6h ago', stale: true, title: 'Stale — no check-in within 4h' });
  });
});

describe('getRosterLoad', () => {
  it('counts current work plus planned tasks', () => {
    expect(getRosterLoad(day())).toBe(0);
    expect(getRosterLoad(day({ currentItem: item(1, 'Now'), plannedItems: [item(2, 'Next'), item(3, 'Later')] }))).toBe(3);
  });
});
