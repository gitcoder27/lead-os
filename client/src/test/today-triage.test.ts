import { describe, expect, it } from 'vitest';
import { buildTodayQueueView, resolveTriageKey, shouldIgnoreTriageEvent } from '@/lib/today-triage';
import { getTodayFreshness } from '@/lib/today-freshness';
import type { TodayActionCommand, TodayActionItem } from '@/types';

const devTarget = { type: 'developer', view: 'team', developerAccountId: 'dev-1' } as const;

function cmd(kind: TodayActionCommand['kind'], label = kind): TodayActionCommand {
  return { kind, label, target: devTarget };
}

function item(id: string, overrides: Partial<TodayActionItem> = {}): TodayActionItem {
  return {
    id,
    type: 'developer_attention',
    title: id,
    context: '',
    signal: '',
    severity: 'warning',
    priority: 50,
    group: 'now',
    target: devTarget,
    primaryAction: cmd('add_check_in'),
    secondaryActions: [cmd('ask_check_in'), cmd('capture_follow_up'), cmd('snooze')],
    ...overrides,
  };
}

describe('resolveTriageKey (docs/53 U4)', () => {
  const row = item('a');

  it('maps movement and undo regardless of the active row', () => {
    expect(resolveTriageKey('j', undefined)).toEqual({ type: 'move', delta: 1 });
    expect(resolveTriageKey('ArrowUp', undefined)).toEqual({ type: 'move', delta: -1 });
    expect(resolveTriageKey('z', undefined)).toEqual({ type: 'undo' });
  });

  it('maps row actions to the row\'s own commands', () => {
    expect(resolveTriageKey('Enter', row)).toEqual({ type: 'open' });
    expect(resolveTriageKey('e', row)).toEqual({ type: 'command', command: row.primaryAction });
    expect(resolveTriageKey(' ', row)).toEqual({ type: 'command', command: row.primaryAction });
    expect(resolveTriageKey('s', row)).toEqual({ type: 'command', command: row.secondaryActions[2], preset: 'tomorrow' });
    expect(resolveTriageKey('f', row)).toEqual({ type: 'command', command: row.secondaryActions[1] });
    expect(resolveTriageKey('c', row)).toEqual({ type: 'command', command: row.primaryAction });
  });

  it('ignores keys the row cannot honour and the calm row', () => {
    const issueRow = item('b', { primaryAction: cmd('open'), secondaryActions: [] });
    expect(resolveTriageKey('s', issueRow)).toBeUndefined();
    expect(resolveTriageKey('c', issueRow)).toBeUndefined();
    expect(resolveTriageKey('e', item('calm', { type: 'calm' }))).toBeUndefined();
    expect(resolveTriageKey('x', row)).toBeUndefined();
  });

  it('never triages inside fields or with modifiers', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const base = { metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false };
    expect(shouldIgnoreTriageEvent({ ...base, target: input })).toBe(true);
    expect(shouldIgnoreTriageEvent({ ...base, target: document.body })).toBe(false);
    expect(shouldIgnoreTriageEvent({ ...base, ctrlKey: true, target: document.body })).toBe(true);
    input.remove();
  });
});

describe('buildTodayQueueView (docs/53 F13)', () => {
  const items = Array.from({ length: 10 }, (_, index) => item(`r${index}`, { group: index < 6 ? 'now' : index < 9 ? 'next' : 'later' }));
  const overflow = [item('o1', { group: 'later' }), item('o2', { group: 'next' })];

  it('collapsed: shows eight rows and counts the honest total', () => {
    const view = buildTodayQueueView({ items, overflowItems: overflow, totalCount: 30, expanded: false });
    expect(view.head.map((row) => row.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']);
    expect(view.groups).toEqual([]);
    expect(view.hiddenCount).toBe(22);
    expect(view.ordered).toHaveLength(8);
  });

  it('expanded: groups the rest Now / Next / Later and keeps rows past the cap hidden', () => {
    const view = buildTodayQueueView({ items, overflowItems: overflow, totalCount: 30, expanded: true });
    expect(view.groups.map((entry) => [entry.group, entry.items.map((row) => row.id)])).toEqual([
      ['next', ['r8', 'o2']],
      ['later', ['r9', 'o1']],
    ]);
    expect(view.hiddenCount).toBe(18);
    expect(view.ordered.map((row) => row.id).slice(8)).toEqual(['r8', 'o2', 'r9', 'o1']);
  });

  it('falls back to counting shipped rows for old servers without totalCount', () => {
    expect(buildTodayQueueView({ items, expanded: false }).hiddenCount).toBe(2);
    expect(buildTodayQueueView({ items: [item('calm', { type: 'calm' })], expanded: false }).hiddenCount).toBe(0);
  });
});

describe('getTodayFreshness (docs/53 U8)', () => {
  it('is fresh after a success', () => {
    expect(getTodayFreshness({ dataUpdatedAt: 2000, errorUpdatedAt: 1000, failedPolls: 3 })).toEqual({ state: 'fresh', updatedAt: 2000, failedPolls: 0 });
  });

  it('is retrying after one failed poll and stale after two', () => {
    const error = new Error('Network down');
    expect(getTodayFreshness({ dataUpdatedAt: 1000, errorUpdatedAt: 2000, failedPolls: 1, error })).toMatchObject({
      state: 'retrying',
      failedPolls: 1,
      lastErrorAt: 2000,
      lastErrorMessage: 'Network down',
    });
    expect(getTodayFreshness({ dataUpdatedAt: 1000, errorUpdatedAt: 3000, failedPolls: 2, error })).toMatchObject({ state: 'stale', updatedAt: 1000 });
  });
});
