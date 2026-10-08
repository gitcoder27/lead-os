import type { ManagerTask } from '@/types';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCapture } from '@/hooks/useCapture';
import { useTaskDetail, useUpdateTaskDetail, useDeleteTaskDetail, useAddTaskDetailLink, useRemoveTaskDetailLink } from '@/hooks/useTaskDetail';
import { useAddTaskEvent, useAddMyDayTaskEvent } from '@/hooks/useTasks';
import { useTaskListMutations } from '@/hooks/useTaskListMutations';
import { invalidateTaskViewCounts } from '@/lib/task-count-invalidation';

let scope = 'workspace:manager:manager:';
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const remove = vi.fn();
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => scope, useAuth: () => ({ user: { role: scope.includes(':developer:') ? 'developer' : 'manager' } }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => get(...args), post: (...args: unknown[]) => post(...args), patch: (...args: unknown[]) => patch(...args), delete: (...args: unknown[]) => remove(...args) } }));

const clients: QueryClient[] = [];
const key = (value = scope) => ['task-view-counts', value, '2026-10-02'];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  clients.push(client);
  client.setQueryData(key(), { counts: { today: { count: 1 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => ({ capture: useCapture(), detail: useUpdateTaskDetail('T-1'), deletion: useDeleteTaskDetail('T-1'), addLink: useAddTaskDetailLink('T-1'), removeLink: useRemoveTaskDetailLink('T-1'), event: useAddTaskEvent('T-1'), developerEvent: useAddMyDayTaskEvent('T-1'), list: useTaskListMutations() }), { wrapper });
  return { ...hook, client };
}
async function advance(ms = 500) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
const captureInput = { text: 'Task', requestId: 'request', clientToday: '2026-10-02' };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); scope = 'workspace:manager:manager:';
  post.mockResolvedValue({ task: { taskKey: 'T-1' }, diagnostics: [] });
  patch.mockResolvedValue({ taskKey: 'T-1' }); remove.mockResolvedValue({ deleted: true });
});
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); vi.clearAllTimers(); vi.useRealTimers(); });

describe('R2 scoped task count invalidation', () => {
  it('coalesces capture and detail writes and marks inactive counts stale', async () => {
    const { result, client } = setup();
    await act(async () => { await result.current.capture.mutateAsync(captureInput); });
    await advance(400);
    await act(async () => { await result.current.detail.mutateAsync({ status: 'done' }); });
    await advance(499);
    expect(client.getQueryState(key())?.isInvalidated).toBe(false);
    await advance(1);
    expect(client.getQueryState(key())?.isInvalidated).toBe(true);
  });

  it('refetches an active count observer once after mixed writes', async () => {
    const { result, client } = setup();
    const read = vi.fn().mockResolvedValue({ counts: { today: { count: 2 } } });
    const observer = new QueryObserver(client, { queryKey: key(), queryFn: read, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    await act(async () => { await result.current.capture.mutateAsync(captureInput); await result.current.addLink.mutateAsync({ kind: 'jira', ref: 'PROJ-1' }); });
    await advance();
    expect(read).toHaveBeenCalledOnce();
    expect(client.getQueryData(key())).toEqual({ counts: { today: { count: 2 } } });
    unsubscribe();
  });

  it.each(['deletion', 'removeLink'] as const)('recounts after %s', async (kind) => {
    const { result, client } = setup();
    await act(async () => { if (kind === 'deletion') await result.current.deletion.mutateAsync(); else await result.current.removeLink.mutateAsync(1); });
    await advance(); expect(client.getQueryState(key())?.isInvalidated).toBe(true);
  });

  it.each([{ blocked: true }, { confirmRequired: true }])('does not recount a refused/confirmation capture %j', async (response) => {
    post.mockResolvedValue({ ...response, diagnostics: [] });
    const { result, client } = setup();
    await act(async () => { await result.current.capture.mutateAsync(captureInput); });
    await advance(); expect(client.getQueryState(key())?.isInvalidated).toBe(false);
  });

  it('does not recount after a failed detail write', async () => {
    patch.mockRejectedValue(new Error('offline'));
    const { result, client } = setup();
    await act(async () => { await expect(result.current.detail.mutateAsync({ status: 'done' })).rejects.toThrow('offline'); });
    await advance(); expect(client.getQueryState(key())?.isInvalidated).toBe(false);
  });

  it('isolates timers across clients and scopes', async () => {
    const { client: a } = setup(); const { client: b } = setup();
    const other = 'workspace:other:manager:';
    a.setQueryData(key(other), {});
    invalidateTaskViewCounts(a, scope); invalidateTaskViewCounts(b, scope);
    await advance(300); invalidateTaskViewCounts(a, other);
    await advance(200);
    expect(a.getQueryState(key())?.isInvalidated).toBe(true);
    expect(b.getQueryState(key())?.isInvalidated).toBe(true);
    expect(a.getQueryState(key(other))?.isInvalidated).toBe(false);
    await advance(300); expect(a.getQueryState(key(other))?.isInvalidated).toBe(true);
  });

  it('ignores developer writes even if a manager count query is cached', async () => {
    scope = 'workspace:dev:developer:dev-1';
    const { result, client } = setup();
    await act(async () => { await result.current.detail.mutateAsync({ status: 'done' }); });
    await advance(); expect(client.getQueryState(key())?.isInvalidated).toBe(false);
  });

  it('ignores a capture response that arrives after auth scope changes', async () => {
    let resolve!: (value: unknown) => void;
    post.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { result, client, rerender } = setup(); const original = scope;
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.capture.mutateAsync(captureInput); });
    await advance(0);
    scope = 'workspace:next:manager:'; client.setQueryData(key(), {}); rerender();
    await act(async () => { resolve({ task: { taskKey: 'T-1' }, diagnostics: [] }); await pending; });
    await advance();
    expect(client.getQueryState(key(original))?.isInvalidated).toBe(false);
    expect(client.getQueryState(key())?.isInvalidated).toBe(false);
  });
});

describe('P07 detail refetches', () => {
  it('refetches once and leaves unrelated details and scopes fresh', async () => {
    const { result, client } = setup();
    const detailKey = ['task-detail', scope, 'manager', 'T-1'];
    client.setQueryData(detailKey, { taskKey: 'T-1', children: [] });
    const unrelated = ['task-detail', scope, 'manager', 'T-2'];
    const otherScope = ['task-detail', 'other', 'manager', 'T-1'];
    const parent = ['task-detail', scope, 'manager', 'T-3'];
    client.setQueryData(unrelated, { children: [] });
    client.setQueryData(otherScope, {});
    client.setQueryData(parent, { children: [{ taskKey: 'T-1' }] });
    const board = ['team-tracker', '2026-10-06', {}, scope];
    client.setQueryData(board, {});
    const read = vi.fn().mockResolvedValue({ taskKey: 'T-1', children: [] });
    const observer = new QueryObserver(client, { queryKey: detailKey, queryFn: read, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    await act(async () => { await result.current.detail.mutateAsync({ status: 'done' }); });
    await advance(0);
    expect(read).toHaveBeenCalledOnce();
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
    expect(client.getQueryState(otherScope)?.isInvalidated).toBe(false);
    expect(client.getQueryState(parent)?.isInvalidated).toBe(true);
    expect(client.getQueryState(board)?.isInvalidated).toBe(true);
    unsubscribe();
  });

  it('forwards cancellation to the detail GET', async () => {
    get.mockImplementation(() => new Promise(() => {}));
    const { client } = setup();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useTaskDetail('T-1'), { wrapper });
    expect(get).toHaveBeenCalledOnce();
    const signal = get.mock.calls[0]![1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    hook.unmount();
    expect(signal.aborted).toBe(true);
  });
});


describe('TR-02 activity and project refresh with active observers', () => {
  const eventInput = { type: 'update' as const, body: 'Fresh update', visibility: 'shared' as const, requestId: 'retry-id' };
  it('updates active stale/Waiting membership immediately and coalesces counts after an event', async () => {
    const { result, client } = setup();
    const tasksKey = ['tasks', scope, 'view', 'waiting'];
    client.setQueryData(tasksKey, { tasks: [{ taskKey: 'T-1', signals: { stale: true } }] });
    const readTasks = vi.fn().mockResolvedValue({ tasks: [] });
    const readCounts = vi.fn().mockResolvedValue({ counts: { waiting: { count: 0 } } });
    const observers = [new QueryObserver(client, { queryKey: tasksKey, queryFn: readTasks, staleTime: Infinity }), new QueryObserver(client, { queryKey: key(), queryFn: readCounts, staleTime: Infinity })];
    const off = observers.map((observer) => observer.subscribe(() => {}));
    await act(async () => { await result.current.event.mutateAsync(eventInput); });
    await advance(0);
    expect(client.getQueryData(tasksKey)).toEqual({ tasks: [] });
    expect(readCounts).not.toHaveBeenCalled();
    await advance();
    expect(client.getQueryData(key())).toEqual({ counts: { waiting: { count: 0 } } });
    expect(readCounts).toHaveBeenCalledOnce();
    off.forEach((stop) => stop());
  });

  it.each(['capture', 'detail', 'list'] as const)('refreshes active directory/detail/track facts after %s; list Undo restores them', async (kind) => {
    const { result, client } = setup();
    let open = 1;
    const facts = () => ({ open, blocked: open, followUpDue: open });
    const directory = ['projects', scope, '2026-10-02'];
    const detail = ['project', scope, 1, '2026-10-02'];
    client.setQueryData(directory, { projects: [{ facts: facts() }] });
    client.setQueryData(detail, { project: { facts: facts() }, tracks: [{ facts: facts() }] });
    const directoryRead = vi.fn(async () => ({ projects: [{ facts: facts() }] }));
    const detailRead = vi.fn(async () => ({ project: { facts: facts() }, tracks: [{ facts: facts() }] }));
    const off = [new QueryObserver(client, { queryKey: directory, queryFn: directoryRead, staleTime: Infinity }).subscribe(() => {}), new QueryObserver(client, { queryKey: detail, queryFn: detailRead, staleTime: Infinity }).subscribe(() => {})];
    const other = ['project', 'other-manager', 1]; client.setQueryData(other, {});
    const inactive = ['projects', scope, 'older-day']; client.setQueryData(inactive, {});
    open = 0;
    const task = { taskKey: 'T-1', status: 'open', ownerType: 'manager', ownerId: 'm', later: false, labels: [], links: [] } as ManagerTask;
    let receipt: Awaited<ReturnType<typeof result.current.list.applyWithReceipt>> = null;
    if (kind === 'list') post.mockResolvedValue({ tasks: [{ ...task, status: 'done' }] });
    await act(async () => {
      if (kind === 'capture') await result.current.capture.mutateAsync(captureInput);
      if (kind === 'detail') await result.current.detail.mutateAsync({ status: 'blocked', followUpAt: '2026-10-02T10:00:00Z' });
      if (kind === 'list') receipt = await result.current.list.applyWithReceipt([{ task, changes: { status: 'done' } }], { label: 'Done', undoable: false });
    });
    await advance(0);
    expect(client.getQueryData(directory)).toEqual({ projects: [{ facts: facts() }] });
    expect(client.getQueryData(detail)).toEqual({ project: { facts: facts() }, tracks: [{ facts: facts() }] });
    expect(directoryRead).toHaveBeenCalledOnce(); expect(detailRead).toHaveBeenCalledOnce();
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    expect(client.getQueryState(inactive)?.isInvalidated).toBe(true);
    if (kind === 'list') {
      open = 1; post.mockResolvedValue({ tasks: [task] });
      await act(async () => { expect(await receipt!.undo()).toBe('undone'); });
      await advance(0);
      expect(client.getQueryData(directory)).toEqual({ projects: [{ facts: facts() }] });
      expect(client.getQueryData(detail)).toEqual({ project: { facts: facts() }, tracks: [{ facts: facts() }] });
    }
    off.forEach((stop) => stop());
  });

  it.each(['capture', 'detail', 'event', 'developerEvent'] as const)('ignores late %s completions across auth changes', async (kind) => {
    let resolve!: (response: unknown) => void;
    const deferred = new Promise((done) => { resolve = done; });
    post.mockReturnValue(deferred); patch.mockReturnValue(deferred);
    const { result, client, rerender } = setup();
    const original = scope;
    const surfaces = ['tasks', 'project', 'projects', 'task-detail', 'task-events'];
    for (const name of surfaces) client.setQueryData([name, original, 'manager', 'T-1'], {});
    let pending!: Promise<unknown>;
    act(() => {
      if (kind === 'capture') pending = result.current.capture.mutateAsync(captureInput);
      if (kind === 'detail') pending = result.current.detail.mutateAsync({ status: 'done' });
      if (kind === 'event') pending = result.current.event.mutateAsync(eventInput);
      if (kind === 'developerEvent') pending = result.current.developerEvent.mutateAsync({ date: '2026-10-02', type: 'update', body: 'Update', requestId: 'id' });
    });
    await advance(0);
    scope = 'workspace:next:manager:';
    for (const name of surfaces) client.setQueryData([name, scope, 'manager', 'T-1'], {});
    rerender();
    await act(async () => { resolve({ task: { taskKey: 'T-1' }, diagnostics: [] }); await pending; });
    await advance();
    for (const name of surfaces) for (const account of [scope, original]) expect(client.getQueryState([name, account, 'manager', 'T-1'])?.isInvalidated).toBe(false);
  });

  it('does not refresh or recount after failed events, and developer events never wake manager queries', async () => {
    const { result, client } = setup();
    const tasks = ['tasks', scope, 'view']; client.setQueryData(tasks, {});
    post.mockRejectedValue(new Error('offline'));
    await act(async () => { await expect(result.current.event.mutateAsync(eventInput)).rejects.toThrow('offline'); });
    await advance(); expect(client.getQueryState(tasks)?.isInvalidated).toBe(false); expect(client.getQueryState(key())?.isInvalidated).toBe(false);
    scope = 'workspace:dev:developer:dev-1';
    const developer = setup();
    const manager = ['task-view-counts', 'workspace:manager:manager:', '2026-10-02']; developer.client.setQueryData(manager, {});
    post.mockResolvedValue({ id: 1 });
    await act(async () => { await developer.result.current.developerEvent.mutateAsync({ date: '2026-10-02', type: 'update', body: 'Fresh', requestId: 'id' }); });
    await advance(); expect(developer.client.getQueryState(manager)?.isInvalidated).toBe(false);
  });
});


it('TR-02 scopes daily keys accurately, refreshes capture parents and keeps unrelated details fresh', async () => {
  const { result, client } = setup();
  const parent = ['task-detail', scope, 'manager', 'T-9'];
  const unrelated = ['task-detail', scope, 'manager', 'T-8'];
  client.setQueryData(parent, { id: 9, taskKey: 'T-9', children: [] });
  client.setQueryData(unrelated, { id: 8, taskKey: 'T-8', children: [] });
  const scoped = [['today', '2026-10-02', scope], ['my-day', '2026-10-02', scope], ['manager-desk', 'task-detail', 9, null, scope], ['team-tracker', 'issue-assignment', '2026-10-02', 'JIRA-1', scope], ['workload', '2026-10-02', scope]];
  for (const query of scoped) { client.setQueryData(query, {}); client.setQueryData([...query.slice(0, -1), 'other'], {}); }
  post.mockResolvedValue({ diagnostics: [], task: { taskKey: 'T-1', parentId: 9 } });
  await act(async () => { await result.current.capture.mutateAsync(captureInput); });
  expect(client.getQueryState(parent)?.isInvalidated).toBe(true);
  expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  for (const query of scoped) {
    expect(client.getQueryState(query)?.isInvalidated).toBe(true);
    expect(client.getQueryState([...query.slice(0, -1), 'other'])?.isInvalidated).toBe(false);
  }
});

it.each([{ blocked: true }, { confirmRequired: true }])('TR-02 leaves project facts fresh for a non-writing capture %j', async (response) => {
  const { result, client } = setup();
  const project = ['project', scope, 1]; client.setQueryData(project, {});
  post.mockResolvedValue({ ...response, diagnostics: [] });
  await act(async () => { await result.current.capture.mutateAsync(captureInput); });
  await advance(); expect(client.getQueryState(project)?.isInvalidated).toBe(false);
});


it('TR-02 refreshes the submitted task when the mounted detail switches keys during a write', async () => {
  const { client } = setup();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const form = renderHook(({ taskKey }) => useAddTaskEvent(taskKey), { wrapper, initialProps: { taskKey: 'T-1' } });
  const first = ['task-detail', scope, 'manager', 'T-1']; const second = ['task-detail', scope, 'manager', 'T-2'];
  client.setQueryData(first, {}); client.setQueryData(second, {});
  let resolve!: (value: unknown) => void;
  post.mockReturnValue(new Promise((done) => { resolve = done; }));
  let pending!: Promise<unknown>;
  act(() => { pending = form.result.current.mutateAsync({ type: 'update', body: 'Update', visibility: 'shared', requestId: 'id' }); });
  await advance(0); form.rerender({ taskKey: 'T-2' });
  await act(async () => { resolve({ id: 1 }); await pending; });
  expect(client.getQueryState(first)?.isInvalidated).toBe(true);
  expect(client.getQueryState(second)?.isInvalidated).toBe(false);
});
