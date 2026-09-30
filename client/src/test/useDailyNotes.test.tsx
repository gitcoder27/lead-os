import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppendDailyNote, useCreateDailyNoteFollowUp, useCreateDailyNoteTask } from '@/hooks/useDailyNotes';
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
    kind: 'scratchpad',
    title: 'note',
    excerpt: '',
    body: 'appended',
    revision: 1,
    createdAt: '2026-04-28T09:00:00.000Z',
    updatedAt: '2026-04-28T09:00:00.000Z',
  },
  followUps: [],
  refs: [],
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

    expect(client.getQueryData<DailyNoteResponse>(['daily-notes', scope, 'day', DATE, 'scratchpad'])?.note?.body).toBe('appended');
  });

  it('appends to a standup note under its own cache key', async () => {
    const client = new QueryClient();
    apiMocks.post.mockResolvedValue({
      ...RESPONSE,
      note: { ...RESPONSE.note!, kind: 'standup' as const },
    });
    const { result } = renderHook(() => useAppendDailyNote(), { wrapper: createWrapper(client) });

    await act(async () => {
      result.current.mutate({ date: DATE, text: 'standup summary', requestId: 'r3', kind: 'standup' });
    });

    expect(apiMocks.post).toHaveBeenCalledWith(`/notes/${DATE}/append`, {
      text: 'standup summary',
      requestId: 'r3',
      kind: 'standup',
    });
    expect(client.getQueryData<DailyNoteResponse>(['daily-notes', scope, 'day', DATE, 'standup'])?.note?.kind).toBe('standup');
    expect(client.getQueryData(['daily-notes', scope, 'day', DATE, 'scratchpad'])).toBeUndefined();
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

    expect(client.getQueryData(['daily-notes', scope, 'day', DATE, 'scratchpad'])).toBeUndefined();
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

    expect(client.getQueryData(['daily-notes', 'ws-1:manager-a:manager:', 'day', DATE, 'scratchpad'])).toBeUndefined();
    expect(client.getQueryData(['daily-notes', 'ws-1:manager-b:manager:', 'day', DATE, 'scratchpad'])).toBeUndefined();
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
      release({ intent: 'create', diagnostics: [], task: { id: 9, taskKey: 'T-9', title: 'call back', followUpAt: null } });
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  describe('note task creation goes through capture (docs/57 P3-05)', () => {
    const created = (overrides: Record<string, unknown> = {}) => ({
      intent: 'create',
      diagnostics: [],
      task: { id: 9, taskKey: 'T-9', title: 'call back', followUpAt: '2026-04-30T09:00:00.000Z', ...overrides },
    });

    it('a follow-up posts the title as capture text, with the note as its source', async () => {
      apiMocks.post.mockResolvedValueOnce(created());
      const { result } = renderHook(() => useCreateDailyNoteFollowUp(DATE), { wrapper: createWrapper(new QueryClient()) });

      let followUp: unknown;
      await act(async () => {
        followUp = await result.current.mutateAsync({
          date: DATE, title: 'call back @dev-1', followUpAt: '2026-04-30T09:00:00.000Z', requestId: 'r3', kind: 'standup',
        });
      });

      expect(apiMocks.post).toHaveBeenCalledWith('/capture', {
        text: 'call back @dev-1',
        clientToday: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        tz: expect.any(String),
        requestId: 'r3',
        defaults: {
          scheduledOn: DATE,
          followUpAt: '2026-04-30T09:00:00.000Z',
          labels: ['category:follow_up'],
          source: { type: 'note', noteDate: DATE, noteKind: 'standup' },
        },
      });
      // The dialogs read the new task key from the same shape as before.
      expect(followUp).toEqual({ itemId: 9, title: 'call back', date: DATE, status: 'planned', followUpAt: '2026-04-30T09:00:00.000Z', taskKey: 'T-9' });
    });

    it('a task carries its developer, Jira issue and context as defaults, and privately', async () => {
      apiMocks.post.mockResolvedValueOnce(created({ followUpAt: null }));
      const { result } = renderHook(() => useCreateDailyNoteTask(DATE), { wrapper: createWrapper(new QueryClient()) });

      let task: unknown;
      await act(async () => {
        task = await result.current.mutateAsync({ title: 'Fix login', developerAccountId: '557058:ab-12', jiraKey: 'LEAD-4', context: 'from standup', requestId: 'r4' });
      });

      const [, body] = apiMocks.post.mock.calls.at(-1)!;
      expect(body).toMatchObject({
        text: 'Fix login',
        requestId: 'r4',
        defaults: {
          ownerAccountId: '557058:ab-12',
          links: { jiraKeys: ['LEAD-4'] },
          contextNote: 'from standup',
          source: { type: 'note', noteDate: DATE },
        },
      });
      expect(task).toEqual({ taskKey: 'T-9', title: 'call back' });
    });

    it('a bare task sends only the note source, so it lands in Inbox', async () => {
      apiMocks.post.mockResolvedValueOnce(created());
      const { result } = renderHook(() => useCreateDailyNoteTask(DATE), { wrapper: createWrapper(new QueryClient()) });
      await act(async () => {
        await result.current.mutateAsync({ title: 'A loose end', requestId: 'r5' });
      });
      const [, body] = apiMocks.post.mock.calls.at(-1)!;
      expect(body.defaults).toEqual({ source: { type: 'note', noteDate: DATE } });
    });

    it('keeps an unknown @name as plain words and retries once', async () => {
      apiMocks.post
        .mockResolvedValueOnce({ intent: 'create', blocked: true, diagnostics: [{ severity: 'error', code: 'unknown-person', message: 'Nobody matches @ghost', token: '@ghost' }] })
        .mockResolvedValueOnce(created());
      const { result } = renderHook(() => useCreateDailyNoteTask(DATE), { wrapper: createWrapper(new QueryClient()) });
      await act(async () => {
        await result.current.mutateAsync({ title: 'Ask @ghost about pricing', requestId: 'r6' });
      });
      expect(apiMocks.post).toHaveBeenCalledTimes(2);
      expect(apiMocks.post.mock.calls[1]![1]).toMatchObject({ text: 'Ask ghost about pricing', requestId: 'r6' });
    });

    it('still rejects an ambiguous name, so the manager chooses', async () => {
      apiMocks.post.mockResolvedValueOnce({ intent: 'create', blocked: true, diagnostics: [{ severity: 'error', code: 'ambiguous-person', message: '@al is ambiguous — pick someone', token: '@al' }] });
      const { result } = renderHook(() => useCreateDailyNoteTask(DATE), { wrapper: createWrapper(new QueryClient()) });
      await act(async () => {
        await expect(result.current.mutateAsync({ title: 'Ask @al', requestId: 'r8' })).rejects.toThrow('ambiguous');
      });
      expect(apiMocks.post).toHaveBeenCalledTimes(1);
    });

    it('refuses text that would be an update or a note instead of a task', async () => {
      const { result } = renderHook(() => useCreateDailyNoteFollowUp(DATE), { wrapper: createWrapper(new QueryClient()) });
      await act(async () => {
        await expect(result.current.mutateAsync({ date: DATE, title: 'T-4: progress', followUpAt: '2026-04-30T09:00:00.000Z', requestId: 'r7' })).rejects.toThrow(/belong in Capture/);
      });
      expect(apiMocks.post).not.toHaveBeenCalled();
    });
  });
});
