import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDailyNoteEditor } from '@/hooks/useDailyNoteEditor';
import { ApiRequestError } from '@/lib/api';
import { readDailyNoteDraft, writeDailyNoteDraft } from '@/lib/daily-note-drafts';
import type { DailyNote, DailyNoteResponse } from '@/types';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/lib/api', () => {
  class MockApiRequestError extends Error {
    status: number;
    body?: unknown;
    constructor(message: string, status: number, body?: unknown) {
      super(message);
      this.name = 'ApiRequestError';
      this.status = status;
      this.body = body;
    }
  }
  return { api: apiMocks, ApiRequestError: MockApiRequestError };
});

const scopeRef = vi.hoisted(() => ({ current: 'ws-1:manager-a:manager:' }));

vi.mock('@/context/AuthContext', () => ({
  useAuthScopeKey: () => scopeRef.current,
  useAuth: () => ({
    user: { username: 'manager-a', accountId: 'manager-a', workspaceId: 'ws-1', role: 'manager' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

const DATE = '2026-04-28';
const SCOPE = 'ws-1:manager-a:manager:';

function note(overrides: Partial<DailyNote> = {}): DailyNote {
  return {
    id: 7,
    date: DATE,
    title: 'First line',
    excerpt: 'First line',
    body: 'saved body',
    revision: 1,
    createdAt: '2026-04-28T08:00:00.000Z',
    updatedAt: '2026-04-28T08:00:00.000Z',
    ...overrides,
  };
}

function dayResponse(value: DailyNote | null): DailyNoteResponse {
  return { note: value, followUps: [] };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient = createQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function until(cond: () => boolean) {
  for (let i = 0; i < 50 && !cond(); i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  expect(cond()).toBe(true);
}

describe('useDailyNoteEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    scopeRef.current = SCOPE;
    apiMocks.get.mockReset();
    apiMocks.put.mockReset();
    apiMocks.post.mockReset();
    apiMocks.get.mockResolvedValue(dayResponse(null));
    apiMocks.put.mockImplementation(async (_url: string, payload: { body: string; revision: number }) =>
      dayResponse(note({ body: payload.body, revision: payload.revision + 1 })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not write when the day is empty and untouched', async () => {
    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });

    await until(() => result.current.saveState === 'idle');
    await advance(2000);

    expect(apiMocks.put).not.toHaveBeenCalled();
    expect(result.current.body).toBe('');
  });

  it('autosaves typed text after the debounce and acknowledges the revision', async () => {
    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'idle');

    act(() => result.current.changeBody('morning notes'));
    expect(result.current.saveState).toBe('dirty');

    await advance(700);

    expect(apiMocks.put).toHaveBeenCalledWith(`/notes/${DATE}`, { body: 'morning notes', revision: 0 });
    expect(result.current.saveState).toBe('saved');
    expect(readDailyNoteDraft(SCOPE, DATE)).toBeNull();
  });

  it('restores a session draft after remount and queues the autosave', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(note()));
    writeDailyNoteDraft(SCOPE, DATE, { body: 'unsynced draft', baseBody: 'saved body', revision: 1 });

    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });

    await until(() => result.current.body === 'unsynced draft');
    await advance(10);

    expect(apiMocks.put).toHaveBeenCalledWith(`/notes/${DATE}`, { body: 'unsynced draft', revision: 1 });
    await until(() => result.current.saveState === 'saved');
  });

  it('surfaces a conflict when the draft diverges from the server body', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(note({ body: 'changed elsewhere', revision: 4 })));
    writeDailyNoteDraft(SCOPE, DATE, { body: 'local draft', baseBody: 'old base', revision: 2 });

    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });

    await until(() => result.current.saveState === 'conflict');
    expect(result.current.body).toBe('local draft');
    expect(result.current.conflict?.body).toBe('changed elsewhere');

    await advance(2000);
    expect(apiMocks.put).not.toHaveBeenCalled();
  });

  it('keeps both versions on conflict resolution', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(note({ body: 'server text', revision: 4 })));
    writeDailyNoteDraft(SCOPE, DATE, { body: 'local draft', baseBody: 'old base', revision: 2 });

    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'conflict');

    act(() => result.current.keepBoth());
    expect(result.current.body).toBe('server text\n\nlocal draft');
    expect(result.current.saveState).toBe('dirty');

    await advance(700);
    expect(apiMocks.put).toHaveBeenCalledWith(`/notes/${DATE}`, {
      body: 'server text\n\nlocal draft',
      revision: 4,
    });
  });

  it('adopts the saved version on conflict resolution', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(note({ body: 'server text', revision: 4 })));
    writeDailyNoteDraft(SCOPE, DATE, { body: 'local draft', baseBody: 'old base', revision: 2 });

    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'conflict');

    act(() => result.current.useSavedVersion());
    expect(result.current.body).toBe('server text');
    expect(result.current.saveState).toBe('idle');
    expect(readDailyNoteDraft(SCOPE, DATE)).toBeNull();
  });

  it('fetches the latest note and enters conflict on a 409', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(note()));
    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'idle');

    apiMocks.put.mockRejectedValueOnce(new ApiRequestError('conflict', 409));
    apiMocks.get.mockResolvedValueOnce(dayResponse(note({ body: 'newer remote', revision: 2 })));

    act(() => result.current.changeBody('local edit'));
    await advance(700);

    await until(() => result.current.saveState === 'conflict');
    expect(result.current.conflict?.body).toBe('newer remote');
    expect(result.current.body).toBe('local edit');
  });

  it('retains text and retries after a failed save', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(note()));
    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'idle');

    apiMocks.put.mockRejectedValueOnce(new ApiRequestError('network down', 0));
    act(() => result.current.changeBody('typed offline'));
    await advance(700);

    await until(() => result.current.saveState === 'error');
    expect(result.current.body).toBe('typed offline');
    expect(readDailyNoteDraft(SCOPE, DATE)?.body).toBe('typed offline');

    act(() => result.current.retrySave());
    await advance(10);
    await until(() => result.current.saveState === 'saved');
    expect(apiMocks.put).toHaveBeenLastCalledWith(`/notes/${DATE}`, { body: 'typed offline', revision: 1 });
  });

  it('queues edits made while a save is in flight', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(note()));
    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'idle');

    let release!: (value: DailyNoteResponse) => void;
    apiMocks.put.mockImplementationOnce(
      () => new Promise<DailyNoteResponse>((resolve) => { release = resolve; }),
    );

    act(() => result.current.changeBody('first'));
    await advance(700);
    await until(() => result.current.saveState === 'saving');

    act(() => result.current.changeBody('first plus more'));
    await act(async () => {
      release(dayResponse(note({ body: 'first', revision: 2 })));
    });

    await until(() => result.current.saveState === 'dirty');
    await advance(700);

    expect(apiMocks.put).toHaveBeenLastCalledWith(`/notes/${DATE}`, { body: 'first plus more', revision: 2 });
  });

  it('does not fire a follow-on write after unmount', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(note()));
    const { result, unmount } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'idle');

    act(() => result.current.changeBody('about to unmount'));
    unmount();
    await advance(2000);

    expect(apiMocks.put).not.toHaveBeenCalled();
    expect(readDailyNoteDraft(SCOPE, DATE)?.body).toBe('about to unmount');
  });

  it('flush returns false while a conflict is unresolved', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(note()));
    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'idle');

    apiMocks.put.mockRejectedValueOnce(new ApiRequestError('conflict', 409));
    apiMocks.get.mockResolvedValueOnce(dayResponse(note({ body: 'remote', revision: 2 })));

    act(() => result.current.changeBody('local'));
    await advance(700);
    await until(() => result.current.saveState === 'conflict');

    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await result.current.flush();
    });
    expect(flushed).toBe(false);
  });

  it('flush saves pending edits and returns true', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(note()));
    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'idle');

    act(() => result.current.changeBody('flush me'));
    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(flushed).toBe(true);
    expect(apiMocks.put).toHaveBeenCalledWith(`/notes/${DATE}`, { body: 'flush me', revision: 1 });
  });

  it('adopts remote changes when clean and conflicts when dirty', async () => {
    const queryClient = createQueryClient();
    apiMocks.get.mockResolvedValue(dayResponse(note()));
    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper(queryClient) });
    await until(() => result.current.saveState === 'idle');

    const remote = dayResponse(note({ body: 'remote edit', revision: 2 }));
    act(() => {
      queryClient.setQueryData(['daily-notes', SCOPE, 'day', DATE], remote);
    });
    await until(() => result.current.body === 'remote edit');

    apiMocks.put.mockRejectedValueOnce(new ApiRequestError('x', 0));
    act(() => result.current.changeBody('dirty again'));
    await advance(700);
    await until(() => result.current.saveState === 'error');

    const remote2 = dayResponse(note({ body: 'someone else', revision: 3 }));
    act(() => {
      queryClient.setQueryData(['daily-notes', SCOPE, 'day', DATE], remote2);
    });
    await until(() => result.current.saveState === 'conflict');
    expect(result.current.body).toBe('dirty again');
  });

  it('keeps the acknowledged baseline while a conflict is unresolved', async () => {
    const queryClient = createQueryClient();
    apiMocks.get.mockResolvedValue(dayResponse(note()));
    const { result, unmount } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper(queryClient) });
    await until(() => result.current.saveState === 'idle');

    act(() => result.current.changeBody('local draft'));
    const remote = dayResponse(note({ body: 'remote rewrite', revision: 2 }));
    act(() => {
      queryClient.setQueryData(['daily-notes', SCOPE, 'day', DATE], remote);
    });
    await until(() => result.current.saveState === 'conflict');

    act(() => result.current.changeBody('local draft v2'));
    unmount();

    const draft = readDailyNoteDraft(SCOPE, DATE);
    expect(draft).toEqual({ body: 'local draft v2', baseBody: 'saved body', revision: 1 });
    await advance(2000);
    expect(apiMocks.put).not.toHaveBeenCalled();
  });

  it('does not silently overwrite the server after remounting a conflicted draft', async () => {
    writeDailyNoteDraft(SCOPE, DATE, { body: 'local work', baseBody: 'saved body', revision: 1 });
    apiMocks.get.mockResolvedValue(dayResponse(note({ body: 'remote rewrite', revision: 2 })));

    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'conflict');

    await advance(2000);
    expect(apiMocks.put).not.toHaveBeenCalled();
    expect(result.current.body).toBe('local work');
    expect(result.current.conflict?.body).toBe('remote rewrite');
  });

  it('stays in conflict when the remote note has been deleted', async () => {
    writeDailyNoteDraft(SCOPE, DATE, { body: 'local work', baseBody: 'saved body', revision: 1 });
    apiMocks.get.mockResolvedValue(dayResponse(null));

    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'conflict');
    expect(result.current.conflict).toBeNull();
    expect(result.current.body).toBe('local work');

    act(() => result.current.useSavedVersion());
    expect(result.current.body).toBe('');
    expect(result.current.saveState).toBe('idle');
  });

  it('flush waits for an in-flight save before testing equality', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(note()));
    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'idle');

    let releaseFirst!: (value: DailyNoteResponse) => void;
    apiMocks.put.mockImplementationOnce(
      () => new Promise<DailyNoteResponse>((resolve) => { releaseFirst = resolve; }),
    );
    apiMocks.put.mockImplementation(async (_url: string, payload: { body: string; revision: number }) =>
      dayResponse(note({ body: payload.body, revision: payload.revision + 1 })),
    );

    act(() => result.current.changeBody('edited version'));
    await advance(700);
    await until(() => result.current.saveState === 'saving');

    act(() => result.current.changeBody('saved body'));

    let flushResult: boolean | undefined;
    let flushDone = false;
    await act(async () => {
      void result.current.flush().then((value) => {
        flushResult = value;
        flushDone = true;
      });
    });
    await advance(0);
    await advance(0);
    expect(flushDone).toBe(false);
    expect(result.current.saveState).toBe('dirty');

    await act(async () => {
      releaseFirst(dayResponse(note({ body: 'edited version', revision: 2 })));
    });

    await until(() => apiMocks.put.mock.calls.length === 2);
    expect(apiMocks.put).toHaveBeenLastCalledWith(`/notes/${DATE}`, { body: 'saved body', revision: 2 });
    await until(() => flushDone === true);
    expect(flushResult).toBe(true);
  });

  it('flush performs a single failed write and reports false', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(note()));
    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'idle');

    apiMocks.put.mockRejectedValue(new ApiRequestError('down', 0));
    act(() => result.current.changeBody('will fail'));

    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(flushed).toBe(false);
    expect(apiMocks.put).toHaveBeenCalledTimes(1);
    expect(result.current.saveState).toBe('error');
  });

  it('treats a whitespace-only new note as synced without looping', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(null));
    apiMocks.put.mockResolvedValue(dayResponse(null));
    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'idle');

    act(() => result.current.changeBody('   '));

    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(flushed).toBe(true);
    expect(apiMocks.put).toHaveBeenCalledTimes(1);
    expect(result.current.saveState).toBe('saved');
    expect(result.current.body).toBe('   ');
  });

  it('rejects over-limit saves locally without dropping the text', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(note()));
    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'idle');

    const overLimit = 'x'.repeat(50001);
    act(() => result.current.changeBody(overLimit));
    await advance(700);

    expect(apiMocks.put).not.toHaveBeenCalled();
    expect(result.current.saveState).toBe('error');
    expect(result.current.error).toContain('50,000');
    expect(result.current.body).toBe(overLimit);

    act(() => result.current.changeBody('trimmed down'));
    await advance(700);
    expect(apiMocks.put).toHaveBeenCalledWith(`/notes/${DATE}`, { body: 'trimmed down', revision: 1 });
  });

  it('ignores a late response after unmount without touching cache or drafts', async () => {
    const queryClient = createQueryClient();
    apiMocks.get.mockResolvedValue(dayResponse(note()));
    const { result, unmount } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper(queryClient) });
    await until(() => result.current.saveState === 'idle');

    let release!: (value: DailyNoteResponse) => void;
    apiMocks.put.mockImplementationOnce(
      () => new Promise<DailyNoteResponse>((resolve) => { release = resolve; }),
    );

    act(() => result.current.changeBody('pending write'));
    await advance(700);
    await until(() => result.current.saveState === 'saving');
    unmount();

    await act(async () => {
      release(dayResponse(note({ body: 'pending write', revision: 2 })));
    });

    const cached = queryClient.getQueryData<DailyNoteResponse>(['daily-notes', SCOPE, 'day', DATE]);
    expect(cached?.note?.body).toBe('saved body');
    expect(readDailyNoteDraft(SCOPE, DATE)?.body).toBe('pending write');
  });

  it('flags unavailable draft storage without losing the text', async () => {
    apiMocks.get.mockResolvedValue(dayResponse(note()));
    const { result } = renderHook(() => useDailyNoteEditor(DATE), { wrapper: createWrapper() });
    await until(() => result.current.saveState === 'idle');

    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    act(() => result.current.changeBody('still here'));
    expect(result.current.recoveryUnavailable).toBe(true);
    expect(result.current.body).toBe('still here');
    setSpy.mockRestore();
  });
});
