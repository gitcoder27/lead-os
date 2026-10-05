import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlacementWrites, useProjectWrites } from '@/hooks/useProjects';

let scope = 'workspace:manager:manager:';
const post = vi.fn();
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => scope }));
vi.mock('@/lib/api', () => ({ api: { post: (...args: unknown[]) => post(...args) } }));
const clients: QueryClient[] = [];
const surfaces = ['projects', 'project', 'tasks', 'task-detail', 'task-view-counts', 'today'];
const key = (surface: string, account = scope) => [surface, account];
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  clients.push(client);
  for (const surface of surfaces) client.setQueryData(key(surface), {});
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => ({ project: useProjectWrites(), placement: usePlacementWrites() }), { wrapper }) };
}
const preview = { keys: ['T-1'], includeSubtasks: false, tasks: [{ taskKey: 'T-1', title: 'Task', placement: null }] };
beforeEach(() => { vi.clearAllMocks(); scope = 'workspace:manager:manager:'; });
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); });

describe('project mutation authentication scope', () => {
  it.each(['project', 'placement'] as const)('does not refresh another login after a late %s write', async (kind) => {
    let resolve!: (value: unknown) => void;
    post.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { result, client, rerender } = setup();
    const original = scope;
    let pending!: Promise<unknown>;
    act(() => {
      pending = kind === 'project'
        ? result.current.project.mutateAsync({ changes: { name: 'Migration' } })
        : result.current.placement.mutateAsync({ preview, placement: null });
    });
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    scope = 'workspace:next:manager:';
    for (const surface of surfaces) client.setQueryData(key(surface), {});
    rerender();
    await act(async () => { resolve({}); await pending; });
    for (const surface of surfaces) {
      expect(client.getQueryState(key(surface, original))?.isInvalidated).toBe(false);
      expect(client.getQueryState(key(surface))?.isInvalidated).toBe(false);
    }
  });

  it('refreshes only the submitting manager after a successful write', async () => {
    post.mockResolvedValue({});
    const { result, client } = setup();
    const other = 'workspace:other:manager:';
    for (const surface of surfaces) client.setQueryData(key(surface, other), {});
    await act(async () => { await result.current.project.mutateAsync({ changes: { name: 'Migration' } }); });
    for (const surface of surfaces) {
      expect(client.getQueryState(key(surface))?.isInvalidated).toBe(true);
      expect(client.getQueryState(key(surface, other))?.isInvalidated).toBe(false);
    }
  });
});
