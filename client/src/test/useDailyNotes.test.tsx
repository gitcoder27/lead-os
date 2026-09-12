import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppendDailyNote, useCreateDailyNoteFollowUp } from '@/hooks/useDailyNotes';
import type { DailyNoteResponse } from '@/types';

const apiMocks = {
  post: vi.fn(),
};

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: (...args: unknown[]) => apiMocks.post(...args),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

let scope = 'ws-1:manager-a:manager:';

vi.mock('@/context/AuthContext', () => ({
  useAuthScopeKey: () => scope,
  useAuth: () => ({
    user: { username: 'manager-a', accountId: 'manager-a', workspaceId: 'ws-1', role: 'manager' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

const DATE = '2026-04-28';
const RESPONSE: DailyNoteResponse = {
  note: {
    id: 1,
    date: DATE,
    title: 'note',
    excerpt: '',
    body: 'appended',
    revision: 1,
    createdAt: '2026-04-28T09:00:00.000Z',
    updatedAt: '2026-04-28T09:00:00.000Z',
  },
  followUps: [],
};

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('daily note mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scope = 'ws-1:manager-a:manager:';
  });

  it('writes the appended note into the day cache on success', async () => {
    const client = new QueryClient();
    apiMocks.post.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => useAppendDailyNote(), { wrapper: createWrapper(client) });

    await act(async () => {
      result.current.mutate({ date: DATE, text: 'appended', requestId: 'r1' });
    });

    expect(client.getQueryData<DailyNoteResponse>(['daily-notes', scope, 'day', DATE])?.note?.body).toBe('appended');
  });

  it('does not repopulate the cache when a deferred append resolves after unmount', async () => {
    const client = new QueryClient();
    let release!: (value: DailyNoteResponse) => void;
    apiMocks.post.mockImplementationOnce(
      () => new Promise<DailyNoteResponse>((resolve) => { release = resolve; }),
    );
    const { result, unmount } = renderHook(() => useAppendDailyNote(), { wrapper: createWrapper(client) });

    await act(async () => {
      result.current.mutate({ date: DATE, text: 'appended', requestId: 'r1' });
    });
    unmount();

    await act(async () => {
      release(RESPONSE);
    });

    expect(client.getQueryData(['daily-notes', scope, 'day', DATE])).toBeUndefined();
  });

  it('does not repopulate the cache when the auth scope changes mid-flight', async () => {
    const client = new QueryClient();
    let release!: (value: DailyNoteResponse) => void;
    apiMocks.post.mockImplementationOnce(
      () => new Promise<DailyNoteResponse>((resolve) => { release = resolve; }),
    );
    const { result, rerender } = renderHook(() => useAppendDailyNote(), { wrapper: createWrapper(client) });

    await act(async () => {
      result.current.mutate({ date: DATE, text: 'appended', requestId: 'r1' });
    });
    scope = 'ws-1:manager-b:manager:';
    rerender();

    await act(async () => {
      release(RESPONSE);
    });

    expect(client.getQueryData(['daily-notes', 'ws-1:manager-a:manager:', 'day', DATE])).toBeUndefined();
    expect(client.getQueryData(['daily-notes', 'ws-1:manager-b:manager:', 'day', DATE])).toBeUndefined();
  });

  it('does not run follow-up invalidations after the auth scope changes mid-flight', async () => {
    const client = new QueryClient();
    let release!: (value: unknown) => void;
    apiMocks.post.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; }),
    );
    const { result, rerender } = renderHook(() => useCreateDailyNoteFollowUp(DATE), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      result.current.mutate({
        date: DATE,
        title: 'call back',
        followUpAt: '2026-04-30T09:00:00.000Z',
        requestId: 'r2',
      });
    });
    scope = 'ws-1:manager-b:manager:';
    rerender();

    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    await act(async () => {
      release({ itemId: 9, date: DATE, title: 'call back', status: 'planned' });
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
