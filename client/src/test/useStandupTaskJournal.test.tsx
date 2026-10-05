import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useStandupTaskJournal } from '@/hooks/useStandupTaskJournal';
import { notifyTaskChange, type TaskChangeNotification } from '@/lib/task-change-notifications';
import type { StandupSession } from '@/lib/standup';
import type { TrackerDeveloperDay } from '@/types';

const session: StandupSession = { roundId: 'r', startedAt: '2026-10-05T09:00:00Z', reviewed: [], flagged: [], log: [] };
const days = [{ developer: { accountId: 'a', displayName: 'Alice' } }, { developer: { accountId: 'b', displayName: 'Bob' } }] as TrackerDeveloperDay[];
const before = { taskKey: 'T-1', title: 'Ship API', ownerType: 'developer', ownerId: 'a', status: 'active' } as const;
const change = (overrides: Partial<TaskChangeNotification> = {}) => ({ scope: 'scope', startedAt: '2026-10-05T10:00:00Z', before, task: { ...before, status: 'done' as const }, fields: ['status'] as const, ...overrides });
const send = (overrides: Partial<TaskChangeNotification> = {}) => act(() => notifyTaskChange(change(overrides) as Omit<TaskChangeNotification, 'id' | 'at'>));

describe('standup drawer action journal', () => {
  it('retains completed task identity and original person after reassignment', () => {
    const dispatch = vi.fn();
    renderHook(() => useStandupTaskJournal('scope', session, days, true, dispatch));
    send();
    send({ fields: ['ownerId'], task: { ...before, ownerId: 'b' } });
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'log', entry: expect.objectContaining({ accountId: 'a', taskKey: 'T-1', taskTitle: 'Ship API', kind: 'done' }) });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'log', entry: expect.objectContaining({ accountId: 'a', kind: 'reassign', detail: 'Bob' }) });
  });
  it('ignores other viewers, writes begun before the round, duplicates and private manager work', () => {
    const dispatch = vi.fn();
    renderHook(() => useStandupTaskJournal('scope', session, days, true, dispatch));
    send({ scope: 'other' });
    send({ startedAt: '2026-10-05T08:00:00Z' });
    send({ before: { ...before, ownerType: 'manager' }, task: { ...before, ownerType: 'manager' } });
    send({ id: 'same' });
    send({ id: 'same' });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('marks private drawer updates without copying the event body', () => {
    const dispatch = vi.fn();
    renderHook(() => useStandupTaskJournal('scope', session, days, true, dispatch));
    send({ task: before, eventType: 'note', private: true });
    expect(dispatch).toHaveBeenCalledWith({ type: 'log', entry: expect.objectContaining({ kind: 'update', private: true }) });
    expect(dispatch.mock.calls[0]![0].entry.detail).toBeUndefined();
  });
  it('does not add writes to a frozen finish retry or a round owned by another tab', () => {
    const dispatch = vi.fn();
    const { rerender } = renderHook(({ own, s }) => useStandupTaskJournal('scope', s, days, own, dispatch), { initialProps: { own: false, s: session } });
    send();
    rerender({ own: true, s: { ...session, request: { requestId: 'r' } as never } });
    send();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('records a title edit and resets duplicate tracking for a fresh round', () => {
    const dispatch = vi.fn();
    const { rerender } = renderHook(({ s }) => useStandupTaskJournal('scope', s, days, true, dispatch), { initialProps: { s: session } });
    send({ id: 'edit', fields: ['title'], task: { ...before, title: 'Renamed' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'log', entry: expect.objectContaining({ kind: 'update', taskTitle: 'Renamed' }) });
    rerender({ s: { ...session, roundId: 'new' } });
    send({ id: 'edit' });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
