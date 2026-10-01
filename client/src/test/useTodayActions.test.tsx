import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/context/ToastContext';
import { useTodayActions } from '@/hooks/useTodayActions';
import type { TodayActionCommand, TodayActionItem, TodayActionTarget, TodayPromiseItem, TodayResponse } from '@/types';

const mockPost = vi.fn();
vi.mock('@/lib/api', () => ({ api: { post: (...args: unknown[]) => mockPost(...args), get: vi.fn() } }));

const DATE = '2026-03-08';
const TODAY_KEY = ['today', DATE, 'scope'] as const;

const taskTarget = (key: string): TodayActionTarget => ({ type: 'task', view: 'tasks', taskKey: key });
const done = (target: TodayActionTarget): TodayActionCommand => ({ kind: 'mark_done', label: 'Done', target });
const carry = (target: TodayActionTarget): TodayActionCommand => ({ kind: 'carry_forward', label: 'Carry', target });

function promise(key: string): TodayPromiseItem {
  const target = taskTarget(key);
  return { id: `promise-${key}`, title: `Promise ${key}`, detail: '', severity: 'warning', target, primaryAction: done(target), secondaryActions: [] };
}

function carryItem(key: string): TodayActionItem {
  const target = taskTarget(key);
  return {
    id: `carry-${key}`, type: 'desk_carry_forward', title: `Carry ${key}`, context: '', signal: 'Carry', severity: 'warning',
    priority: 50, group: 'next', target, primaryAction: carry(target), secondaryActions: [done(target)],
  };
}

function wrapUpSnapshot(): TodayResponse {
  return {
    date: DATE,
    generatedAt: `${DATE}T16:00:00.000Z`,
    rhythm: { stage: 'wrap_up', label: 'Wrap-up', detail: '' },
    summary: [],
    actionItems: [carryItem('T-1'), carryItem('T-2')],
    teamPulse: [],
    promises: [promise('T-3')],
    standupPrompts: [],
    meetingPrompts: [],
    focus: {
      stage: 'wrap_up',
      wrapUp: {
        missingCheckIns: [],
        openPromises: [promise('T-3')],
        carryCandidates: [carryItem('T-1'), carryItem('T-2')],
        eodNoteTarget: { type: 'view', view: 'notes', date: DATE },
      },
    },
  };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(TODAY_KEY, wrapUpSnapshot());
  client.setQueryData(['tasks', 'scope', 'view', 'waiting', DATE], { tasks: [] });
  client.setQueryData(['task-detail', 'scope', 'manager', 'T-3'], { key: 'T-3' });
  client.setQueryData(['task-events', 'scope', 'manager', 'T-3'], { events: [] });
  client.setQueryData(['task-view-counts', 'scope', DATE], { counts: {} });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
  );
  const onOpenTarget = vi.fn();
  const hook = renderHook(() => useTodayActions({ date: DATE, onOpenTarget }), { wrapper });
  const snapshot = () => client.getQueryData<TodayResponse>(TODAY_KEY)!;
  const invalidated = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated === true;
  return { client, hook, snapshot, invalidated };
}

describe('useTodayActions — mutation truth (docs/63 #1)', () => {
  beforeEach(() => {
    mockPost.mockReset();
    vi.useRealTimers();
  });

  it('puts the row back when a write fails, even if the refetch never answers', async () => {
    mockPost.mockRejectedValue(new Error('Task changed'));
    const { hook, snapshot } = setup();
    const before = snapshot();

    await act(async () => {
      await hook.result.current.runActionAsync(done(taskTarget('T-3'))).catch(() => undefined);
    });

    const after = snapshot();
    expect(after.promises.map((item) => item.id)).toEqual(['promise-T-3']);
    expect(after.focus && 'wrapUp' in after.focus ? after.focus.wrapUp.openPromises : []).toHaveLength(1);
    expect(after.actionItems).toHaveLength(before.actionItems.length);
  });

  it('drops the wrap-up promise and carry rows at once on success, so nothing is left to click twice', async () => {
    let release!: () => void;
    mockPost.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ label: 'ok' }); }));
    const { hook, snapshot } = setup();

    let write!: Promise<void>;
    act(() => { write = hook.result.current.runActionAsync(done(taskTarget('T-3'))); });
    await waitFor(() => {
      const focus = snapshot().focus;
      expect(focus && 'wrapUp' in focus && focus.wrapUp.openPromises).toHaveLength(0);
    });
    await act(async () => { release(); await write; });
  });

  it('sends one write for a double click on the same row', async () => {
    let release!: () => void;
    mockPost.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ label: 'ok' }); }));
    const { hook } = setup();

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = hook.result.current.runActionAsync(carry(taskTarget('T-1')));
      second = hook.result.current.runActionAsync(carry(taskTarget('T-1')));
      hook.result.current.runAction(carry(taskTarget('T-1')));
    });
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    await act(async () => { release(); await Promise.all([first, second]); });

    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('invalidates Tasks lists, drawers, events and counts after a write', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockPost.mockResolvedValue({ label: 'ok' });
    const { hook, invalidated } = setup();

    await act(async () => { await hook.result.current.runActionAsync(done(taskTarget('T-3'))); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(invalidated(['tasks', 'scope', 'view', 'waiting', DATE])).toBe(true);
    expect(invalidated(['task-detail', 'scope', 'manager', 'T-3'])).toBe(true);
    expect(invalidated(['task-events', 'scope', 'manager', 'T-3'])).toBe(true);
    expect(invalidated(['task-view-counts', 'scope', DATE])).toBe(true);
    expect(invalidated(['manager-actions'])).toBe(false);
    vi.useRealTimers();
  });

  it('invalidates the same caches after a failed write', async () => {
    mockPost.mockRejectedValue(new Error('nope'));
    const { hook, invalidated } = setup();
    await act(async () => { await hook.result.current.runActionAsync(done(taskTarget('T-3'))).catch(() => undefined); });
    expect(invalidated(['tasks', 'scope', 'view', 'waiting', DATE])).toBe(true);
    expect(invalidated(['task-detail', 'scope', 'manager', 'T-3'])).toBe(true);
  });

  it('bulk: a failure mid-way restores the rows that never landed and keeps the ones that did', async () => {
    mockPost
      .mockResolvedValueOnce({ label: 'ok' })
      .mockRejectedValueOnce(new Error('second failed'));
    const { hook, snapshot } = setup();
    const commands = [carry(taskTarget('T-1')), carry(taskTarget('T-2'))];

    await act(async () => { await hook.result.current.runBulk(commands, (count) => `Carried ${count}`); });

    const ids = snapshot().actionItems.map((item) => item.id);
    expect(ids).toEqual(['carry-T-2']);
    const focus = snapshot().focus;
    expect(focus && 'wrapUp' in focus ? focus.wrapUp.carryCandidates.map((item) => item.id) : []).toEqual(['carry-T-2']);
  });

  it('bulk: a repeated Carry all does not resend rows already being written', async () => {
    let release!: () => void;
    mockPost.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ label: 'ok' }); }));
    const { hook } = setup();
    const commands = [carry(taskTarget('T-1')), carry(taskTarget('T-2'))];

    let first!: Promise<void>;
    act(() => {
      first = hook.result.current.runBulk(commands, (count) => `Carried ${count}`);
    });
    await act(async () => { await hook.result.current.runBulk(commands, (count) => `Carried ${count}`); });
    expect(mockPost).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2)); release(); await first; });
    expect(mockPost).toHaveBeenCalledTimes(2);
  });
});
