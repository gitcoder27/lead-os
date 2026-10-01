import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrefetchStandupFeeds, useStandupFeed } from '@/hooks/useTeamTracker';

const mockGet = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'scope-a' }));

const feed = (id: string) => ({ entries: [{ id: `event:${id}` }], windowStart: '2026-03-06T09:00:00Z', windowHours: 24 });

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe('standup feed preloading', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockImplementation((url: string) => Promise.resolve(feed(new URL(url, 'http://x').searchParams.get('accountId')!)));
  });

  it('loads each listed person once, so a later switch reads from cache with no loading state', async () => {
    const { wrapper } = setup();
    const prefetch = renderHook(({ ids }) => usePrefetchStandupFeeds(ids), { wrapper, initialProps: { ids: ['dev-2', 'dev-3'] } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(mockGet.mock.calls.map(([url]) => new URL(url as string, 'http://x').searchParams.get('accountId')).sort()).toEqual(['dev-2', 'dev-3']);

    // Moving to dev-2: data is there on the first render.
    const switched = renderHook(() => useStandupFeed('dev-2'), { wrapper });
    expect(switched.result.current.isLoading).toBe(false);
    expect(switched.result.current.data).toEqual(feed('dev-2'));

    // The same ids again, or the same people while still fresh, send nothing.
    prefetch.rerender({ ids: ['dev-2', 'dev-3'] });
    prefetch.rerender({ ids: ['dev-3', 'dev-2'] });
    await Promise.resolve();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('only fetches the person who is newly in range as the cursor moves', async () => {
    const { wrapper } = setup();
    const prefetch = renderHook(({ ids }) => usePrefetchStandupFeeds(ids), { wrapper, initialProps: { ids: ['dev-2', 'dev-3'] } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    prefetch.rerender({ ids: ['dev-3', 'dev-4', 'dev-1'] });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(4));
    const ids = mockGet.mock.calls.slice(2).map(([url]) => new URL(url as string, 'http://x').searchParams.get('accountId')).sort();
    expect(ids).toEqual(['dev-1', 'dev-4']);
  });

  it('does nothing while disabled (not on a person screen) and on an empty list', async () => {
    const { wrapper } = setup();
    renderHook(() => usePrefetchStandupFeeds(['dev-2'], false), { wrapper });
    renderHook(() => usePrefetchStandupFeeds([]), { wrapper });
    await Promise.resolve();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
