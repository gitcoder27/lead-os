import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import type { GlobalSearchResponse } from '@/types';

const get = vi.fn();
let scope = 'workspace:manager:one';
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => get(...args) } }));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => scope }));

interface SearchRequest {
  url: string;
  signal: AbortSignal;
  resolve: (value: GlobalSearchResponse) => void;
}
let requests: SearchRequest[];
let client: QueryClient;
const response = (query: string): GlobalSearchResponse => ({
  query, tasks: [], issues: [], deskItems: [], trackerItems: [], checkIns: [], developers: [],
});
const advance = async (ms = 150) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};
const complete = async (request: SearchRequest, text: string) => {
  await act(async () => { request.resolve(response(text)); });
  await advance(1);
};
function setup(query = '', enabled = true) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(({ query, enabled }) => useGlobalSearch(query, { enabled }), {
    initialProps: { query, enabled }, wrapper,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
  scope = 'workspace:manager:one';
  requests = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  get.mockImplementation((url: string, { signal }: { signal: AbortSignal }) =>
    new Promise<GlobalSearchResponse>((resolve) => { requests.push({ url, signal, resolve }); }),
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useGlobalSearch', () => {
  it('waits for valid settled text and encodes the final trimmed request', async () => {
    const { result, rerender } = setup();
    rerender({ query: 'a', enabled: true });
    await advance();
    expect(get).not.toHaveBeenCalled();
    rerender({ query: 'ab', enabled: true });
    expect(result.current.isSearching).toBe(true);
    await advance(100);
    rerender({ query: ' abc & ', enabled: true });
    await advance(149);
    expect(get).not.toHaveBeenCalled();
    await advance(1);
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/search?q=abc%20%26', { signal: expect.any(AbortSignal) });
    expect(requests[0]!.signal.aborted).toBe(false);
    await complete(requests[0]!, 'abc &');
    expect(result.current.data?.query).toBe('abc &');
    expect(result.current.isSearching).toBe(false);
  });

  it('aborts immediately when superseded and ignores out-of-order completion', async () => {
    const { result, rerender } = setup('alpha');
    await advance();
    const old = requests[0]!;
    rerender({ query: 'beta', enabled: true });
    expect(old.signal.aborted).toBe(true);
    expect(result.current.data).toBeUndefined();
    await advance();
    const current = requests[1]!;
    expect(current.url).toBe('/search?q=beta');
    await complete(current, 'beta');
    await complete(old, 'alpha');
    expect(result.current.data?.query).toBe('beta');
    expect(client.getQueryData(['global-search', scope, 'alpha'])).toBeUndefined();
  });

  it.each(['a', '', '   '])('aborts and hides results when shortened to %j', async (query) => {
    const { result, rerender } = setup('alpha');
    await advance();
    const old = requests[0]!;
    rerender({ query, enabled: true });
    expect(old.signal.aborted).toBe(true);
    expect(result.current.isSearching).toBe(false);
    await complete(old, 'alpha');
    await advance();
    expect(get).toHaveBeenCalledOnce();
    expect(result.current.data).toBeUndefined();
  });

  it('aborts on unmount and clears the pending debounce timer', async () => {
    const active = setup('alpha');
    await advance();
    active.unmount();
    expect(requests[0]!.signal.aborted).toBe(true);
    const typing = setup('beta');
    typing.unmount();
    await advance();
    expect(get).toHaveBeenCalledOnce();
  });

  it('does not fetch while disabled and cancels when disabled mid-request', async () => {
    const { result, rerender } = setup('alpha', false);
    await advance();
    expect(get).not.toHaveBeenCalled();
    rerender({ query: 'alpha', enabled: true });
    await advance();
    expect(get).toHaveBeenCalledOnce();
    rerender({ query: 'alpha', enabled: false });
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isSearching).toBe(false);
  });

  it('waits again when typing returns to a superseded query', async () => {
    const { rerender } = setup('alpha');
    await advance();
    rerender({ query: 'beta', enabled: true });
    await advance(50);
    rerender({ query: 'alpha', enabled: true });
    await advance(149);
    expect(get).toHaveBeenCalledOnce();
    await advance(1);
    expect(get).toHaveBeenCalledTimes(2);
    expect(requests[1]!.url).toBe('/search?q=alpha');
  });

  it('hides cached results until settled and isolates the cache by auth scope', async () => {
    client.setQueryData(['global-search', scope, 'alpha'], response('alpha'));
    const { result, rerender } = setup('alpha');
    expect(result.current.data).toBeUndefined();
    await advance();
    expect(result.current.data?.query).toBe('alpha');
    expect(get).not.toHaveBeenCalled();
    rerender({ query: 'a', enabled: true });
    expect(result.current.data).toBeUndefined();
    scope = 'workspace:manager:two';
    rerender({ query: 'alpha', enabled: true });
    await advance();
    expect(result.current.data).toBeUndefined();
    expect(get).toHaveBeenCalledOnce();
    await complete(requests[0]!, 'alpha');
    expect(client.getQueryData(['global-search', scope, 'alpha'])).toEqual(response('alpha'));
  });

  it('reuses fresh cached responses and fetches again after 30 seconds', async () => {
    client.setQueryData(['global-search', scope, 'alpha'], response('alpha'));
    const first = setup('alpha');
    await advance();
    first.unmount();
    await advance(29_000);
    const fresh = setup('alpha');
    await advance();
    expect(get).not.toHaveBeenCalled();
    fresh.unmount();
    await advance(1_000);
    setup('alpha');
    await advance();
    expect(get).toHaveBeenCalledOnce();
  });
});
