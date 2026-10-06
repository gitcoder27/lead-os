import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCapture } from '@/hooks/useCapture';
import { useTaskDetail, useUpdateTaskDetail, useDeleteTaskDetail, useAddTaskDetailLink, useRemoveTaskDetailLink } from '@/hooks/useTaskDetail';
import { invalidateTaskViewCounts } from '@/lib/task-count-invalidation';

let scope = 'workspace:manager:manager:';
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const remove = vi.fn();
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => scope, useAuth: () => ({ user: { role: scope.includes(':developer:') ? 'developer' : 'manager' } }) }));
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => get(...args), post: (...args: unknown[]) => post(...args), patch: (...args: unknown[]) => patch(...args), delete: (...args: unknown[]) => remove(...args) } }));

const clients: QueryClient[] = [];
const key = (value = scope) => ['task-view-counts', value, '2026-10-02'];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  clients.push(client);
  client.setQueryData(key(), { counts: { today: { count: 1 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => ({ capture: useCapture(), detail: useUpdateTaskDetail('T-1'), deletion: useDeleteTaskDetail('T-1'), addLink: useAddTaskDetailLink('T-1'), removeLink: useRemoveTaskDetailLink('T-1') }), { wrapper });
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
