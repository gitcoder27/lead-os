import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ManagerTask, TaskViewTasksResponse } from '@/types';

const mockPost = vi.fn();
const mockAddToast = vi.fn();
let mockScope = 'scope';

vi.mock('@/lib/api', () => {
  class ApiRequestError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiRequestError, api: { post: (...args: unknown[]) => mockPost(...args) } };
});
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => mockScope }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mockAddToast }) }));

import { ApiRequestError } from '@/lib/api';
import { useTaskListMutations } from '@/hooks/useTaskListMutations';

const CONFLICT = 'Could not undo: a task changed since this action. Nothing was undone.';

function task(overrides: Partial<ManagerTask> = {}): ManagerTask {
  return {
    id: 1, taskKey: 'T-1', title: 'One', kind: 'task', status: 'open', ownerType: 'manager', ownerId: 'm', priority: 'normal',
    scheduledOn: '2026-09-20', dueAt: null, startsAt: null, endsAt: null, participants: null, outcome: null,
    createdByType: 'manager', createdById: 'm', createdAt: '', updatedAt: '', closedAt: null, deletedAt: null, links: [],
    later: false, parentId: null, trackedByManagerId: 'm', labels: [], nextAction: null, followUpAt: null,
    hideUntil: null, needsTriage: false, waitingOn: null, schedulePosition: null, details: null,
    ...overrides,
  } as ManagerTask;
}

const VIEW_KEY = ['tasks', 'scope', 'view', 'abc', '2026-09-26'];
const ONE = task();
const TWO = task({ id: 2, taskKey: 'T-2', title: 'Two' });

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(tasks: ManagerTask[] = [ONE], client?: QueryClient) {
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (!client) qc.setQueryData<TaskViewTasksResponse>(VIEW_KEY, { tasks: tasks.map((entry) => ({ ...entry, signals: {} as never })) });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useTaskListMutations(), { wrapper });
  return { client: qc, result: hook.result, rerender: hook.rerender };
}

const cached = (client: QueryClient, key: string) => client.getQueryData<TaskViewTasksResponse>(VIEW_KEY)!.tasks.find((entry) => entry.taskKey === key)!;
const undoToast = () => mockAddToast.mock.calls.map((call) => call[0]).find((toast) => toast.action?.label === 'Undo');

beforeEach(() => {
  vi.clearAllMocks();
  mockScope = 'scope';
});

describe('useTaskListMutations (docs/49 R7)', () => {
  it('patches cached rows optimistically and posts per-task changes with the pre-action values as a guard', async () => {
    const write = deferred();
    mockPost.mockReturnValue(write.promise);
    const { client, result } = setup();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.apply([{ task: ONE, changes: { status: 'done' } }], { label: 'Done' }); });
    await vi.waitFor(() => expect(cached(client, 'T-1').status).toBe('done'));
    expect(cached(client, 'T-1').closedAt).toBeTruthy();
    expect(mockPost).toHaveBeenCalledWith('/tasks/bulk', { items: [{ key: 'T-1', changes: { status: 'done' }, expected: { status: 'open', triaged: true } }] });
    await act(async () => { write.resolve({ tasks: [task({ status: 'done', closedAt: 'x' })] }); await pending; });
  });

  it('rolls back and toasts on error', async () => {
    mockPost.mockRejectedValue(new Error('T-1: nope'));
    const { client, result } = setup();
    let ok = true;
    await act(async () => { ok = await result.current.apply([{ task: ONE, changes: { status: 'done' } }], { label: 'Done' }); });
    expect(ok).toBe(false);
    expect(cached(client, 'T-1').status).toBe('open');
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'T-1: nope' }));
  });

  it('offers Undo that re-applies previous values through the same endpoint, guarded by the acknowledged values', async () => {
    // The server's answer differs from the optimistic guess (it stamped its own hideUntil), and the guard must use it.
    mockPost.mockResolvedValueOnce({ tasks: [task({ later: true, scheduledOn: null, hideUntil: '2026-09-30' })] });
    mockPost.mockResolvedValueOnce({ tasks: [ONE] });
    const onUndo = vi.fn();
    const { result } = setup();
    await act(async () => { await result.current.apply([{ task: ONE, changes: { later: true } }], { label: 'Moved to Later', onUndo }); });
    const toast = undoToast();
    expect(toast).toMatchObject({ type: 'success', title: 'Moved to Later', action: { label: 'Undo' } });
    await act(async () => { toast.action.onClick(); });
    expect(onUndo).toHaveBeenCalled();
    expect(mockPost).toHaveBeenLastCalledWith('/tasks/bulk', {
      items: [{ key: 'T-1', changes: { later: false, scheduledOn: '2026-09-20' }, expected: { later: true, scheduledOn: null, hideUntil: '2026-09-30', triaged: true } }],
    });
    // The undo itself is not undoable.
    expect(mockAddToast).toHaveBeenCalledTimes(1);
  });

  it('undoLast reverses the latest write once, like the toast (docs/54 K5)', async () => {
    mockPost.mockResolvedValueOnce({ tasks: [task({ status: 'done', closedAt: 'x' })] });
    mockPost.mockResolvedValue({ tasks: [ONE] });
    const { result } = setup();
    expect(result.current.undoLast()).toBe(false);
    await act(async () => { await result.current.apply([{ task: ONE, changes: { status: 'done' } }], { label: 'Done' }); });
    let undone = false;
    await act(async () => { undone = result.current.undoLast(); });
    expect(undone).toBe(true);
    expect(mockPost).toHaveBeenLastCalledWith('/tasks/bulk', { items: [{ key: 'T-1', changes: { status: 'open' }, expected: { status: 'done', triaged: true } }] });
    const calls = mockPost.mock.calls.length;
    // The toast's Undo and a second `z` are now no-ops.
    await act(async () => { undoToast().action.onClick(); });
    expect(result.current.undoLast()).toBe(false);
    expect(mockPost.mock.calls.length).toBe(calls);
  });

  it('skips the toast when undoable is false and no-ops on empty input', async () => {
    mockPost.mockResolvedValue({ tasks: [task({ labels: ['x'] })] });
    const { result } = setup();
    await act(async () => { await result.current.apply([{ task: ONE, changes: { labels: ['x'] } }], { label: 'x', undoable: false }); });
    expect(mockAddToast).not.toHaveBeenCalled();
    expect(await result.current.apply([], { label: 'x' })).toBe(false);
  });
});

describe('guarded Undo (docs/61 TS-01, D1)', () => {
  async function scheduled() {
    mockPost.mockResolvedValueOnce({ tasks: [task({ scheduledOn: '2026-09-21' })] });
    const setupResult = setup();
    await act(async () => { await setupResult.result.current.apply([{ task: ONE, changes: { scheduledOn: '2026-09-21', later: false } }], { label: 'Tomorrow' }); });
    return setupResult;
  }

  it('shows the persistent refusal on a 409, announces no success, and does not offer the Undo again', async () => {
    const { result } = await scheduled();
    const toast = undoToast();
    mockPost.mockRejectedValueOnce(new ApiRequestError('T-1: Task changed since this action', 409));
    mockAddToast.mockClear();
    await act(async () => { toast.action.onClick(); });
    const raised = mockAddToast.mock.calls.map((call) => call[0]);
    expect(raised).toEqual([expect.objectContaining({ type: 'error', title: CONFLICT })]);
    expect(raised[0]).not.toHaveProperty('duration');
    const calls = mockPost.mock.calls.length;
    expect(result.current.undoLast()).toBe(false);
    await act(async () => { toast.action.onClick(); });
    expect(mockPost.mock.calls.length).toBe(calls);
  });

  it('keeps a failed Undo retryable inside its window and suppresses duplicate submissions', async () => {
    const { result } = await scheduled();
    const first = deferred();
    mockPost.mockReturnValueOnce(first.promise);
    let started = false;
    await act(async () => { started = result.current.undoLast(); });
    expect(started).toBe(true);
    const inFlight = mockPost.mock.calls.length;
    // A second press or toast click while the request is out sends nothing.
    await act(async () => { result.current.undoLast(); undoToast().action.onClick(); });
    expect(mockPost.mock.calls.length).toBe(inFlight);
    await act(async () => { first.reject(new Error('network down')); await first.promise.catch(() => undefined); });
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', title: 'Could not update tasks' }));

    mockPost.mockResolvedValueOnce({ tasks: [ONE] });
    let retried = false;
    await act(async () => { retried = result.current.undoLast(); });
    expect(retried).toBe(true);
    expect(mockPost.mock.calls.length).toBe(inFlight + 1);
    expect(result.current.undoLast()).toBe(false);
  });

  it('exposes a receipt whose undo reports the outcome to callers such as Weekly review', async () => {
    mockPost.mockResolvedValueOnce({ tasks: [task({ status: 'done', closedAt: 'x' })] });
    const { result } = setup();
    let receipt: Awaited<ReturnType<typeof result.current.applyWithReceipt>> = null;
    await act(async () => { receipt = await result.current.applyWithReceipt([{ task: ONE, changes: { status: 'done' } }], { label: 'Done', undoable: false }); });
    expect(receipt).not.toBeNull();
    expect(mockAddToast).not.toHaveBeenCalled();

    mockPost.mockRejectedValueOnce(new ApiRequestError('T-1: Task changed since this action', 409));
    let outcome = '';
    await act(async () => { outcome = await receipt!.undo(); });
    expect(outcome).toBe('conflict');
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', title: CONFLICT }));

    mockPost.mockResolvedValueOnce({ tasks: [ONE] });
    await act(async () => { outcome = await receipt!.undo(); });
    expect(outcome).toBe('undone');
  });

  it('offers no Undo when the response cannot supply the acknowledged values', async () => {
    mockPost.mockResolvedValueOnce({ tasks: [] });
    const { result } = setup();
    await act(async () => { await result.current.apply([{ task: ONE, changes: { status: 'done' } }], { label: 'Done' }); });
    expect(undoToast()).toBeUndefined();
    expect(result.current.undoLast()).toBe(false);
  });

  it('refuses a stale forward action without success side effects', async () => {
    mockPost.mockRejectedValueOnce(new ApiRequestError('T-1: Task changed since this action', 409));
    const { client, result } = setup();
    let ok = true;
    await act(async () => { ok = await result.current.apply([{ task: ONE, changes: { status: 'done' } }], { label: 'Done' }); });
    expect(ok).toBe(false);
    expect(undoToast()).toBeUndefined();
    expect(cached(client, 'T-1').status).toBe('open');
  });
});

describe('overlapping writes (docs/61 TS-01, D1)', () => {
  it('a failed write for one task never reverts another task that succeeded', async () => {
    const a = deferred();
    const b = deferred();
    mockPost.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { client, result } = setup([ONE, TWO]);
    let pendingA!: Promise<boolean>;
    let pendingB!: Promise<boolean>;
    act(() => {
      pendingA = result.current.apply([{ task: ONE, changes: { status: 'done' } }], { label: 'A' });
      pendingB = result.current.apply([{ task: TWO, changes: { status: 'done' } }], { label: 'B' });
    });
    await vi.waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    await act(async () => { b.resolve({ tasks: [task({ ...TWO, status: 'done', closedAt: 'x' })] }); await pendingB; });
    await act(async () => { a.reject(new Error('T-1: nope')); await pendingA; });
    expect(cached(client, 'T-1').status).toBe('open');
    expect(cached(client, 'T-2').status).toBe('done');
  });

  it('an older failure does not overwrite a newer refetch of the same field', async () => {
    const a = deferred();
    mockPost.mockReturnValueOnce(a.promise);
    const { client, result } = setup();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.apply([{ task: ONE, changes: { status: 'done' } }], { label: 'A' }); });
    await vi.waitFor(() => expect(cached(client, 'T-1').status).toBe('done'));
    // A refetch lands with fresher server data before A fails.
    act(() => { client.setQueryData<TaskViewTasksResponse>(VIEW_KEY, { tasks: [{ ...task({ status: 'blocked' }), signals: {} as never }] }); });
    await act(async () => { a.reject(new Error('T-1: nope')); await pending; });
    expect(cached(client, 'T-1').status).toBe('blocked');
  });

  it('rolls back only its own fields when a neighbouring edit changed others', async () => {
    const a = deferred();
    mockPost.mockReturnValueOnce(a.promise);
    const { client, result } = setup();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.apply([{ task: ONE, changes: { status: 'done' } }], { label: 'A' }); });
    await vi.waitFor(() => expect(cached(client, 'T-1').status).toBe('done'));
    act(() => { client.setQueryData<TaskViewTasksResponse>(VIEW_KEY, (old) => ({ tasks: old!.tasks.map((entry) => ({ ...entry, title: 'Renamed elsewhere' })) })); });
    await act(async () => { a.reject(new Error('T-1: nope')); await pending; });
    expect(cached(client, 'T-1')).toMatchObject({ status: 'open', title: 'Renamed elsewhere' });
  });

  it('runs writes for the same task one after another, across hook instances, on the acknowledged values', async () => {
    const a = deferred();
    mockPost.mockReturnValueOnce(a.promise);
    const { client, result } = setup();
    const second = setup([], client);
    let pendingA!: Promise<boolean>;
    let pendingB!: Promise<boolean>;
    act(() => {
      pendingA = result.current.apply([{ task: ONE, changes: { scheduledOn: '2026-09-21', later: false } }], { label: 'A' });
      pendingB = second.result.current.apply([{ task: ONE, changes: { scheduledOn: '2026-09-22', later: false } }], { label: 'B' });
    });
    await vi.waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    // B waits: it has neither patched the cache nor gone to the server.
    expect(cached(client, 'T-1').scheduledOn).toBe('2026-09-21');
    mockPost.mockResolvedValueOnce({ tasks: [task({ scheduledOn: '2026-09-22' })] });
    await act(async () => { a.resolve({ tasks: [task({ scheduledOn: '2026-09-21' })] }); await pendingA; await pendingB; });
    expect(mockPost).toHaveBeenCalledTimes(2);
    // B's guard is A's acknowledged value, not the stale row it was clicked on.
    expect(mockPost.mock.calls[1]![1].items[0].expected).toMatchObject({ scheduledOn: '2026-09-21' });
  });

  it('a different task is not held up by a pending write', async () => {
    mockPost.mockReturnValue(new Promise(() => undefined));
    const { result } = setup([ONE, TWO]);
    act(() => {
      void result.current.apply([{ task: ONE, changes: { status: 'done' } }], { label: 'A' });
      void result.current.apply([{ task: TWO, changes: { status: 'done' } }], { label: 'B' });
    });
    await vi.waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
  });

  it('neutralises a write that finishes after the signed-in scope changed', async () => {
    const a = deferred();
    mockPost.mockReturnValueOnce(a.promise);
    const { result, rerender } = setup();
    let ok = true;
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.apply([{ task: ONE, changes: { status: 'done' } }], { label: 'Done' }); });
    await vi.waitFor(() => expect(mockPost).toHaveBeenCalled());
    mockScope = 'other-scope';
    rerender();
    await act(async () => { a.resolve({ tasks: [task({ status: 'done', closedAt: 'x' })] }); ok = await pending; });
    expect(ok).toBe(false);
    expect(mockAddToast).not.toHaveBeenCalled();
  });
});
