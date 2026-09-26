import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ManagerTask, TaskViewTasksResponse } from '@/types';

const mockPost = vi.fn();
const mockAddToast = vi.fn();

vi.mock('@/lib/api', () => ({ api: { post: (...args: unknown[]) => mockPost(...args) } }));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'scope' }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mockAddToast }) }));

import { useTaskListMutations } from '@/hooks/useTaskListMutations';

function task(overrides: Partial<ManagerTask> = {}): ManagerTask {
  return {
    id: 1, taskKey: 'T-1', title: 'One', kind: 'task', status: 'open', ownerType: 'manager', ownerId: 'm', priority: 'normal',
    scheduledOn: '2026-09-20', dueAt: null, startsAt: null, endsAt: null, participants: null, outcome: null,
    createdByType: 'manager', createdById: 'm', createdAt: '', updatedAt: '', closedAt: null, deletedAt: null, links: [],
    later: false, parentId: null, trackedByManagerId: 'm', labels: [], nextAction: null, followUpAt: null,
    ...overrides,
  } as ManagerTask;
}

const VIEW_KEY = ['tasks', 'scope', 'view', 'abc', '2026-09-26'];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData<TaskViewTasksResponse>(VIEW_KEY, { tasks: [{ ...task(), signals: {} as never }] });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useTaskListMutations(), { wrapper });
  return { client, result };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTaskListMutations (docs/49 R7)', () => {
  it('patches cached rows optimistically and posts per-task changes', async () => {
    let resolve!: (value: unknown) => void;
    mockPost.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { client, result } = setup();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.apply([{ task: task(), changes: { status: 'done' } }], { label: 'Done' }); });
    await vi.waitFor(() => expect(client.getQueryData<TaskViewTasksResponse>(VIEW_KEY)!.tasks[0]!.status).toBe('done'));
    expect(client.getQueryData<TaskViewTasksResponse>(VIEW_KEY)!.tasks[0]!.closedAt).toBeTruthy();
    expect(mockPost).toHaveBeenCalledWith('/tasks/bulk', { items: [{ key: 'T-1', changes: { status: 'done' } }] });
    await act(async () => { resolve({ tasks: [] }); await pending; });
  });

  it('rolls back and toasts on error', async () => {
    mockPost.mockRejectedValue(new Error('T-1: nope'));
    const { client, result } = setup();
    let ok = true;
    await act(async () => { ok = await result.current.apply([{ task: task(), changes: { status: 'done' } }], { label: 'Done' }); });
    expect(ok).toBe(false);
    expect(client.getQueryData<TaskViewTasksResponse>(VIEW_KEY)!.tasks[0]!.status).toBe('open');
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'T-1: nope' }));
  });

  it('offers Undo that re-applies previous values through the same endpoint', async () => {
    mockPost.mockResolvedValue({ tasks: [] });
    const onUndo = vi.fn();
    const { result } = setup();
    await act(async () => { await result.current.apply([{ task: task(), changes: { later: true } }], { label: 'Moved to Later', onUndo }); });
    const toast = mockAddToast.mock.calls[0]![0];
    expect(toast).toMatchObject({ type: 'success', title: 'Moved to Later', action: { label: 'Undo' } });
    await act(async () => { toast.action.onClick(); });
    expect(onUndo).toHaveBeenCalled();
    expect(mockPost).toHaveBeenLastCalledWith('/tasks/bulk', { items: [{ key: 'T-1', changes: { later: false, scheduledOn: '2026-09-20' } }] });
    // The undo itself is not undoable.
    expect(mockAddToast).toHaveBeenCalledTimes(1);
  });

  it('skips the toast when undoable is false and no-ops on empty input', async () => {
    mockPost.mockResolvedValue({ tasks: [] });
    const { result } = setup();
    await act(async () => { await result.current.apply([{ task: task(), changes: { labels: ['x'] } }], { label: 'x', undoable: false }); });
    expect(mockAddToast).not.toHaveBeenCalled();
    expect(await result.current.apply([], { label: 'x' })).toBe(false);
  });
});
