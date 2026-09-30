import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ManagerTask, TaskDetailResponse, TaskViewTasksResponse } from '@/types';

/** docs/61 TS-01 (D1): list writes and drawer writes on the same task share one ordered lifecycle. */
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockAddToast = vi.fn();

vi.mock('@/lib/api', () => ({ api: { post: (...args: unknown[]) => mockPost(...args), patch: (...args: unknown[]) => mockPatch(...args), get: vi.fn() } }));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'scope', useAuth: () => ({ user: { role: 'manager', accountId: 'm' } }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mockAddToast }) }));

import { useTaskListMutations } from '@/hooks/useTaskListMutations';
import { useUpdateTaskDetail } from '@/hooks/useTaskDetail';

function task(overrides: Partial<ManagerTask> = {}): ManagerTask {
  return {
    id: 1, taskKey: 'T-1', title: 'One', details: null, kind: 'task', status: 'open', ownerType: 'manager', ownerId: 'm', priority: 'normal',
    scheduledOn: '2026-09-20', dueAt: null, startsAt: null, endsAt: null, participants: null, outcome: null,
    createdByType: 'manager', createdById: 'm', createdAt: '', updatedAt: '', closedAt: null, deletedAt: null, links: [],
    later: false, parentId: null, trackedByManagerId: 'm', labels: [], nextAction: null, followUpAt: null,
    hideUntil: null, needsTriage: false, waitingOn: null, schedulePosition: null,
    ...overrides,
  } as ManagerTask;
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const LIST_KEY = ['tasks', 'scope', 'view', 'abc', '2026-09-26'];
const DETAIL_KEY = ['task-detail', 'scope', 'manager', 'T-1'];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData<TaskViewTasksResponse>(LIST_KEY, { tasks: [{ ...task(), signals: {} as never }] });
  client.setQueryData(DETAIL_KEY, { ...task(), children: [], parent: null });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const list = renderHook(() => useTaskListMutations(), { wrapper });
  const detail = renderHook(() => useUpdateTaskDetail('T-1'), { wrapper });
  return { client, list: list.result, detail: detail.result };
}

const detailOf = (client: QueryClient) => client.getQueryData<TaskDetailResponse>(DETAIL_KEY)!;

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

beforeEach(() => vi.clearAllMocks());

describe('list and drawer writes on one task', () => {
  it('a drawer edit waits for a pending list write, then goes out', async () => {
    const list = deferred();
    mockPost.mockReturnValueOnce(list.promise);
    mockPatch.mockResolvedValue(task({ title: 'Renamed' }));
    const { client, list: listHook, detail } = setup();
    let listDone!: Promise<boolean>;
    act(() => { listDone = listHook.current.apply([{ task: task(), changes: { status: 'done' } }], { label: 'Done' }); });
    await vi.waitFor(() => expect(mockPost).toHaveBeenCalled());
    act(() => { detail.current.mutate({ title: 'Renamed' }); });
    await settle();
    // Not sent and not patched yet: the list write owns the task until it settles.
    expect(mockPatch).not.toHaveBeenCalled();
    expect(detailOf(client).title).toBe('One');

    await act(async () => { list.resolve({ tasks: [task({ status: 'done', closedAt: 'x' })] }); await listDone; });
    await vi.waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/tasks/T-1', { title: 'Renamed' }));
    expect(detailOf(client).title).toBe('Renamed');
  });

  it('a list action waits for a pending drawer edit and acts on what the edit saved', async () => {
    const saving = deferred();
    mockPatch.mockReturnValueOnce(saving.promise);
    mockPost.mockResolvedValue({ tasks: [task({ status: 'done', closedAt: 'x', title: 'Renamed' })] });
    const { list: listHook, detail } = setup();
    act(() => { detail.current.mutate({ title: 'Renamed' }); });
    await vi.waitFor(() => expect(mockPatch).toHaveBeenCalled());
    let listDone!: Promise<boolean>;
    act(() => { listDone = listHook.current.apply([{ task: task(), changes: { status: 'done' } }], { label: 'Done' }); });
    await settle();
    expect(mockPost).not.toHaveBeenCalled();

    await act(async () => { saving.resolve(task({ title: 'Renamed', updatedAt: 'later' })); await listDone; });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('a failed drawer edit puts back only the fields it wrote, never a newer refetch', async () => {
    const saving = deferred();
    mockPatch.mockReturnValueOnce(saving.promise);
    const { client, detail } = setup();
    act(() => { detail.current.mutate({ title: 'Mine', details: 'Mine too' }); });
    await vi.waitFor(() => expect(detailOf(client).title).toBe('Mine'));
    // Fresh server data lands for the title while the request is out.
    act(() => { client.setQueryData(DETAIL_KEY, { ...detailOf(client), title: 'From the server' }); });
    await act(async () => { saving.reject(new Error('nope')); await saving.promise.catch(() => undefined); });
    await vi.waitFor(() => expect(detailOf(client)).toMatchObject({ title: 'From the server', details: null }));
  });

  it('a failed drawer edit does not hold back the next one', async () => {
    mockPatch.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(task({ title: 'Second' }));
    const { detail } = setup();
    await act(async () => { await detail.current.mutateAsync({ title: 'First' }).catch(() => undefined); });
    await act(async () => { await detail.current.mutateAsync({ title: 'Second' }); });
    expect(mockPatch).toHaveBeenCalledTimes(2);
  });
});
